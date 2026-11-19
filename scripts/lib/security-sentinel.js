"use strict";
// scripts/lib/security-sentinel.js — 底层安全与运行时版本周检纯逻辑（零网络、零子进程，供离线门禁测试）。
// 规则：
//   1. Electron 仅跟踪「同大版本稳定补丁」，且默认遵守 72 小时（UPDATE_MIN_AGE_DAYS=3）等待期。
//   2. 依赖漏洞只看生产依赖（--omit=dev）与随包分发的 Electron 运行时包（与 desktop/scripts/audit-runtime.mjs 同口径）
//      中的 high / critical，过滤构建工具链噪音。
//   3. 零风险或仅在等待期内时绝不开单；有风险时合并为单条 [security-watch] issue 并按指纹去重。

const crypto = require("node:crypto");

const DEFAULT_MIN_AGE_DAYS = 3;
const DAY_MS = 24 * 60 * 60 * 1000;
const SECURITY_LABEL = "security-watch";
const MARKER_RE = /<!--\s*polyask-security-watch:\s*(\{[^\n]*?\})\s*-->/;

// 与 desktop/scripts/audit-runtime.mjs 严格同口径：只在打包/签名/下载期跑、不进 app.asar 的 @electron/* 工具链包。
const BUILD_TIME_ELECTRON_SCOPE = new Set([
  "@electron/asar", "@electron/fuses", "@electron/get", "@electron/node-gyp", "@electron/notarize",
  "@electron/osx-sign", "@electron/packager", "@electron/rebuild", "@electron/universal", "@electron/windows-sign"
]);

function isRuntimeElectronPackage(name) {
  if (name === "electron") return true;
  return typeof name === "string"
    && name.startsWith("@electron/")
    && !BUILD_TIME_ELECTRON_SCOPE.has(name);
}

function parseStableSemver(raw) {
  const match = String(raw || "").trim().match(/^v?(\d+)\.(\d+)\.(\d+)$/);
  if (!match) return null;
  return {
    version: `${Number(match[1])}.${Number(match[2])}.${Number(match[3])}`,
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3])
  };
}

function compareSemver(a, b) {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  return a.patch - b.patch;
}

function evaluateElectronReleases(input) {
  const current = parseStableSemver(input.currentVersion);
  if (!current) throw new Error(`invalid_current_electron:${input.currentVersion}`);
  const minAgeDays = Number.isFinite(input.minAgeDays) && input.minAgeDays >= 0
    ? Number(input.minAgeDays)
    : DEFAULT_MIN_AGE_DAYS;
  const minAgeMs = minAgeDays * DAY_MS;
  const nowMs = Number.isFinite(input.nowMs) ? input.nowMs : Date.now();
  if (!Array.isArray(input.releases)) throw new Error("electron_releases_invalid");

  let eligible = null;
  const coolingDown = [];

  for (const row of input.releases) {
    if (!row || row.draft === true || row.prerelease === true) continue;
    const parsed = parseStableSemver(row.tag_name || row.name);
    if (!parsed || parsed.major !== current.major) continue;
    if (compareSemver(parsed, current) <= 0) continue;
    const publishedMs = Date.parse(String(row.published_at || ""));
    if (!Number.isFinite(publishedMs)) continue;
    const ageMs = Math.max(0, nowMs - publishedMs);
    const candidate = {
      version: parsed.version,
      semver: parsed,
      publishedAt: new Date(publishedMs).toISOString(),
      ageHours: Math.floor(ageMs / 3_600_000),
      url: typeof row.html_url === "string" && row.html_url.startsWith("https://")
        ? row.html_url
        : `https://github.com/electron/electron/releases/tag/v${parsed.version}`
    };
    if (ageMs >= minAgeMs) {
      if (!eligible || compareSemver(candidate.semver, eligible.semver) > 0) eligible = candidate;
    } else {
      coolingDown.push(candidate);
    }
  }

  coolingDown.sort((a, b) => compareSemver(b.semver, a.semver));
  return {
    current: current.version,
    minAgeDays,
    eligible: eligible ? {
      version: eligible.version,
      publishedAt: eligible.publishedAt,
      ageHours: eligible.ageHours,
      url: eligible.url
    } : null,
    coolingDown: coolingDown.map(({ semver: _s, ...rest }) => rest)
  };
}

function parseNpmAuditJson(stdout) {
  let report;
  try {
    report = JSON.parse(String(stdout || ""));
  } catch (err) {
    throw new Error(`npm_audit_invalid_json:${err.message}`);
  }
  if (report && typeof report === "object"
    && report.vulnerabilities && typeof report.vulnerabilities === "object"
    && report.metadata && typeof report.metadata === "object") {
    return report;
  }
  const failure = (report && report.error) || {};
  const detail = [failure.code, failure.summary || failure.message].filter(Boolean).join(" ");
  throw new Error(`npm_audit_missing_vulnerabilities:${detail || "malformed_report"}`);
}

function extractProdPackageNames(lockJson) {
  const lock = typeof lockJson === "string" ? JSON.parse(lockJson) : lockJson;
  const packages = lock && typeof lock.packages === "object" ? lock.packages : {};
  const names = new Set();
  for (const [pkgPath, meta] of Object.entries(packages)) {
    if (!pkgPath.startsWith("node_modules/") || !meta || meta.dev === true) continue;
    const segments = pkgPath.split("node_modules/").filter(Boolean);
    const leaf = segments[segments.length - 1];
    if (leaf) names.add(leaf);
  }
  return names;
}

function extractAdvisoryDetails(via) {
  if (!Array.isArray(via)) return { titles: [], ids: [] };
  const titles = [], ids = [];
  for (const item of via) {
    if (!item || typeof item !== "object") continue;
    const url = typeof item.url === "string" && item.url.startsWith("https://") ? item.url : null;
    if (typeof item.title === "string") titles.push(url ? `${item.title} (${url})` : item.title);
    const ghsa = url && url.match(/GHSA-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{4}/i);
    const id = ghsa ? ghsa[0].toLowerCase()
      : (Number.isInteger(item.source) ? `src:${item.source}` : (url || item.title || null));
    if (id) ids.push(String(id));
  }
  return { titles: [...new Set(titles)].slice(0, 6), ids: [...new Set(ids)].sort() };
}

function collectRuntimeAdvisories(input) {
  const prodVulns = (input.prodAudit && input.prodAudit.vulnerabilities) || {};
  const fullVulns = (input.fullAudit && input.fullAudit.vulnerabilities) || {};
  const prodNames = input.prodPackageNames instanceof Set ? input.prodPackageNames : null;
  const byName = new Map();

  const record = (vuln, scope) => {
    if (!vuln || typeof vuln.name !== "string") return;
    if (vuln.severity !== "high" && vuln.severity !== "critical") return;
    const details = extractAdvisoryDetails(vuln.via);
    const existing = byName.get(vuln.name);
    if (existing) {
      const severity = existing.severity === "critical" || vuln.severity === "critical" ? "critical" : "high";
      byName.set(vuln.name, {
        name: vuln.name,
        severity,
        scope: existing.scope === "prod" ? "prod" : scope,
        range: existing.range === vuln.range || typeof vuln.range !== "string" ? existing.range : `${existing.range}|${vuln.range}`,
        fixAvailable: existing.fixAvailable || Boolean(vuln.fixAvailable),
        titles: [...new Set([...existing.titles, ...details.titles])].slice(0, 6),
        ids: [...new Set([...existing.ids, ...details.ids])].sort()
      });
      return;
    }
    byName.set(vuln.name, {
      name: vuln.name,
      severity: vuln.severity,
      scope,
      range: typeof vuln.range === "string" ? vuln.range : "*",
      fixAvailable: Boolean(vuln.fixAvailable),
      titles: details.titles,
      ids: details.ids
    });
  };

  for (const vuln of Object.values(prodVulns)) {
    if (prodNames && !prodNames.has(vuln.name)) continue;
    record(vuln, "prod");
  }
  for (const vuln of Object.values(fullVulns)) {
    if (!isRuntimeElectronPackage(vuln.name)) continue;
    record(vuln, "electron-runtime");
  }

  return [...byName.values()].sort((a, b) => {
    if (a.severity !== b.severity) return a.severity === "critical" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

function computeFingerprint(electronResult, advisories) {
  const payload = JSON.stringify({
    electron: electronResult.eligible ? electronResult.eligible.version : null,
    advisories: advisories.map((a) => `${a.scope}:${a.name}:${a.severity}:${a.range}:${(a.ids || []).join(",")}`)
  });
  return crypto.createHash("sha256").update(payload).digest("hex").slice(0, 16);
}

function readIssueFingerprint(issue) {
  const body = typeof issue?.body === "string" ? issue.body : "";
  const match = body.match(MARKER_RE);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[1]);
    return typeof parsed?.fingerprint === "string" ? parsed.fingerprint : null;
  } catch {
    return null;
  }
}

function buildIssueTitle(electronResult, advisories) {
  const parts = [];
  if (advisories.length > 0) parts.push(`${advisories.length} 项运行时高危安全公告`);
  if (electronResult.eligible) parts.push(`Electron ${electronResult.current} → ${electronResult.eligible.version}`);
  return `[security-watch] ${parts.join(" · ")}`;
}

function buildIssueBody(input) {
  const { electronResult, advisories, observedDate, fingerprint } = input;
  const marker = `<!-- polyask-security-watch: ${JSON.stringify({ fingerprint })} -->`;
  const lines = [
    marker,
    `观测日期（UTC）：\`${observedDate}\` · 冷却门槛：\`${electronResult.minAgeDays} 天（${electronResult.minAgeDays * 24}h）\``,
    ""
  ];
  if (advisories.length > 0) {
    lines.push("## 生产 / Electron 运行时安全公告（High / Critical）", "");
    for (const item of advisories) {
      const detail = item.titles.length ? ` — ${item.titles.join("；")}` : "";
      lines.push(`- **${item.name}** (\`${item.severity}\`, \`${item.scope}\`, 受影响范围 \`${item.range}\`)${detail}`);
    }
    lines.push("");
  }
  if (electronResult.eligible) {
    const patch = electronResult.eligible;
    lines.push(
      "## Electron 同大版本稳定补丁（已满等待期）",
      "",
      `- 当前固定版本：\`${electronResult.current}\``,
      `- 可评估版本：[\`v${patch.version}\`](${patch.url})（发布于 \`${patch.publishedAt.slice(0, 10)}\`，已满 \`${patch.ageHours}h\`）`,
      "- 升级核对：`polyask-electron` 技能清单（Cookie 加密 Fuse、九站 WebContentsView 冒烟、Windows 试玩版刷新）。",
      ""
    );
  }
  return lines.join("\n").trimEnd() + "\n";
}

function planSecurityIssue(input) {
  const { electronResult, advisories, existingIssues = [], observedDate } = input;
  if (!electronResult.eligible && advisories.length === 0) {
    return { action: "none", fingerprint: null };
  }
  const fingerprint = computeFingerprint(electronResult, advisories);
  for (const issue of existingIssues) {
    if (readIssueFingerprint(issue) === fingerprint) {
      return { action: "noop", issueNumber: issue.number, fingerprint };
    }
  }
  const title = buildIssueTitle(electronResult, advisories);
  const body = buildIssueBody({ electronResult, advisories, observedDate, fingerprint });
  const openIssue = existingIssues.find((issue) => issue.state === "open");
  if (openIssue) {
    return { action: "update", issueNumber: openIssue.number, title, body, fingerprint };
  }
  return { action: "create", title, body, fingerprint };
}

module.exports = {
  SECURITY_LABEL,
  DEFAULT_MIN_AGE_DAYS,
  isRuntimeElectronPackage,
  parseStableSemver,
  compareSemver,
  evaluateElectronReleases,
  parseNpmAuditJson,
  extractProdPackageNames,
  collectRuntimeAdvisories,
  readIssueFingerprint,
  planSecurityIssue
};
