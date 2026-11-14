"use strict";
// 底层安全与版本周检哨兵离线门禁测试：不走网络、不跑在线 npm audit，完整覆盖 72h 等待期、运行时依赖过滤、单帖去重与 dry-run。
const assert = require("node:assert/strict");
const { test } = require("node:test");
const {
  evaluateElectronReleases,
  parseNpmAuditJson,
  extractProdPackageNames,
  collectRuntimeAdvisories,
  planSecurityIssue
} = require("./lib/security-sentinel.js");
const { runSecurityWatch, fetchElectronReleasesPaginated } = require("./watch-security.js");

const NOW = Date.parse("2026-11-16T02:23:00Z");
const HOUR = 3_600_000;

function emptyAudit(vulns = {}) {
  return { vulnerabilities: vulns, metadata: { vulnerabilities: {} } };
}

test("Electron 同大版本补丁遵守 72 小时等待期，忽略预发布、草稿与跨大版本", () => {
  const releases = [
    { tag_name: "v45.0.0", draft: false, prerelease: false, published_at: new Date(NOW - 200 * HOUR).toISOString() },
    { tag_name: "v44.9.6-beta.1", draft: false, prerelease: true, published_at: new Date(NOW - 200 * HOUR).toISOString() },
    { tag_name: "v44.9.5", draft: true, prerelease: false, published_at: new Date(NOW - 200 * HOUR).toISOString() },
    // 刚发布 48h：仍在 72h 冷却期内
    { tag_name: "v44.9.5", draft: false, prerelease: false, published_at: new Date(NOW - 48 * HOUR).toISOString() },
    // 已满 80h：可进入提醒
    { tag_name: "v44.9.4", draft: false, prerelease: false, published_at: new Date(NOW - 80 * HOUR).toISOString() }
  ];
  const res = evaluateElectronReleases({ currentVersion: "44.9.3", releases, nowMs: NOW, minAgeDays: 3 });
  assert.equal(res.eligible?.version, "44.9.4");
  assert.deepEqual(res.coolingDown.map((c) => c.version), ["44.9.5"]);

  const coolingOnly = evaluateElectronReleases({
    currentVersion: "44.9.4",
    releases,
    nowMs: NOW,
    minAgeDays: 3
  });
  assert.equal(coolingOnly.eligible, null, "仅存在未满 72 小时的新补丁时不得触发提醒");
  assert.deepEqual(coolingOnly.coolingDown.map((c) => c.version), ["44.9.5"]);
});

test("依赖安全过滤仅放行生产依赖与随包 Electron 运行时的 high/critical，并拦截残缺审计 JSON", () => {
  assert.throws(() => parseNpmAuditJson('{"error":{"code":"ENOAUDIT","summary":"registry down"}}'), /npm_audit_missing_vulnerabilities/);

  const prodNames = extractProdPackageNames({
    packages: {
      "": { name: "polyask-desktop" },
      "node_modules/markdown-it": { version: "15.0.3" },
      "node_modules/webpack": { version: "5.97.1", dev: true }
    }
  });
  assert.equal(prodNames.has("markdown-it"), true);
  assert.equal(prodNames.has("webpack"), false);

  const advisories = collectRuntimeAdvisories({
    prodPackageNames: prodNames,
    prodAudit: emptyAudit({
      "markdown-it": {
        name: "markdown-it",
        severity: "high",
        range: "<15.0.4",
        fixAvailable: true,
        via: [{ title: "ReDoS in markdown-it", url: "https://github.com/advisories/GHSA-xxxx" }]
      },
      katex: { name: "katex", severity: "moderate", range: "<0.18.10", fixAvailable: true, via: [] },
      webpack: { name: "webpack", severity: "critical", range: "*", fixAvailable: false, via: [] }
    }),
    fullAudit: emptyAudit({
      "@electron/rebuild": { name: "@electron/rebuild", severity: "high", range: "*", fixAvailable: false, via: [] },
      "@electron/packager": { name: "@electron/packager", severity: "critical", range: "*", fixAvailable: false, via: [] },
      electron: {
        name: "electron",
        severity: "critical",
        range: "<44.9.4",
        fixAvailable: true,
        via: [{ title: "Chromium V8 out-of-bounds write" }]
      }
    })
  });

  assert.deepEqual(advisories.map((a) => `${a.scope}:${a.name}:${a.severity}`), [
    "electron-runtime:electron:critical",
    "prod:markdown-it:high"
  ]);
});

test("零风险零打扰、同指纹幂等去重、已有未关单时原位更新，且 dry-run 不写远端", async () => {
  const issues = [];
  const writes = [];
  const logs = [];
  let getCalls = 0;
  const github = async (method, apiPath, body) => {
    if (method === "GET") { getCalls += 1; return structuredClone(issues); }
    if (apiPath === "/labels") return {};
    writes.push({ method, apiPath, body });
    if (method === "POST") {
      const created = { number: issues.length + 1, state: "open", ...body };
      issues.push(created);
      return created;
    }
    const found = issues.find((item) => apiPath === `/issues/${item.number}`);
    Object.assign(found, body);
    return found;
  };

  const baseOpts = {
    now: new Date(NOW),
    minAgeDays: 3,
    desktopPkg: { devDependencies: { electron: "44.9.3" } },
    desktopLock: { packages: { "node_modules/react": { version: "19.2.8" } } },
    github,
    log: (line) => logs.push(line)
  };

  // 1. 无到期补丁且无高危漏洞 -> 零写入、零 GitHub API 读取、默认静默零日志
  await runSecurityWatch({
    ...baseOpts,
    dryRun: false,
    fetchElectronReleases: async () => [{ tag_name: "v44.9.4", draft: false, prerelease: false, published_at: new Date(NOW - 24 * HOUR).toISOString() }],
    readAudits: async () => [emptyAudit(), emptyAudit()]
  });
  assert.equal(writes.length, 0, "冷却期内且零漏洞不得开单");
  assert.equal(getCalls, 0, "无风险或仅在冷却期内不得请求 GitHub Issues API");
  assert.equal(logs.length, 0, "默认静默巡检不得产生冷却噪音日志");

  // 2. dry-run 下即使满足条件也不写远端
  await runSecurityWatch({
    ...baseOpts,
    dryRun: true,
    fetchElectronReleases: async () => [{ tag_name: "v44.9.4", draft: false, prerelease: false, published_at: new Date(NOW - 96 * HOUR).toISOString() }],
    readAudits: async () => [emptyAudit(), emptyAudit()]
  });
  assert.equal(writes.length, 0, "dry-run 严禁写 GitHub");

  // 3. 正式运行创建单条汇总 issue，同指纹再跑一遍为 noop
  await runSecurityWatch({
    ...baseOpts,
    dryRun: false,
    fetchElectronReleases: async () => [{ tag_name: "v44.9.4", draft: false, prerelease: false, published_at: new Date(NOW - 96 * HOUR).toISOString() }],
    readAudits: async () => [emptyAudit(), emptyAudit()]
  });
  assert.equal(issues.length, 1);
  assert.match(issues[0].title, /\[security-watch\] Electron 44\.9\.3 → 44\.9\.4/);

  await runSecurityWatch({
    ...baseOpts,
    dryRun: false,
    fetchElectronReleases: async () => [{ tag_name: "v44.9.4", draft: false, prerelease: false, published_at: new Date(NOW - 100 * HOUR).toISOString() }],
    readAudits: async () => [emptyAudit(), emptyAudit()]
  });
  assert.equal(writes.length, 1, "同指纹重复巡检不得重复发帖或改帖");

  // 4. 新补丁 v44.9.5 满等待期且旧单仍 open -> PATCH 更新同一张单，不堆叠多单
  await runSecurityWatch({
    ...baseOpts,
    dryRun: false,
    fetchElectronReleases: async () => [{ tag_name: "v44.9.5", draft: false, prerelease: false, published_at: new Date(NOW - 96 * HOUR).toISOString() }],
    readAudits: async () => [emptyAudit(), emptyAudit()]
  });
  assert.equal(issues.length, 1);
  assert.equal(writes.at(-1).method, "PATCH");
  assert.match(issues[0].title, /44\.9\.5/);

  // 5. 若维护者已关闭该指纹单，同一指纹后续不再鞭尸重开
  issues[0].state = "closed";
  const closedCheck = planSecurityIssue({
    electronResult: evaluateElectronReleases({
      currentVersion: "44.9.3",
      releases: [{ tag_name: "v44.9.5", draft: false, prerelease: false, published_at: new Date(NOW - 120 * HOUR).toISOString() }],
      nowMs: NOW,
      minAgeDays: 3
    }),
    advisories: [],
    existingIssues: issues,
    observedDate: "2026-11-16"
  });
  assert.equal(closedCheck.action, "noop");
});

test("同包同受影响范围新增不同 GHSA 时更新指纹，且 Electron 多页分页覆盖到当前版本为止", async () => {
  const electronClean = evaluateElectronReleases({ currentVersion: "44.9.3", releases: [], nowMs: NOW, minAgeDays: 3 });
  const adv1 = collectRuntimeAdvisories({
    prodAudit: emptyAudit({
      ws: { name: "ws", severity: "high", range: "<8.17.1", fixAvailable: true, via: [{ title: "DoS #1", url: "https://github.com/advisories/GHSA-1111-2222-3333" }] }
    }),
    fullAudit: emptyAudit()
  });
  const firstPlan = planSecurityIssue({ electronResult: electronClean, advisories: adv1, existingIssues: [], observedDate: "2026-11-16" });
  assert.equal(firstPlan.action, "create");

  const adv2 = collectRuntimeAdvisories({
    prodAudit: emptyAudit({
      ws: { name: "ws", severity: "high", range: "<8.17.1", fixAvailable: true, via: [{ title: "DoS #2", url: "https://github.com/advisories/GHSA-4444-5555-6666" }] }
    }),
    fullAudit: emptyAudit()
  });
  const openUpdate = planSecurityIssue({
    electronResult: electronClean,
    advisories: adv2,
    existingIssues: [{ number: 12, state: "open", body: firstPlan.body }],
    observedDate: "2026-11-16"
  });
  assert.equal(openUpdate.action, "update", "同包同范围新增不同 GHSA 不得与旧单碰撞");
  const closedReopen = planSecurityIssue({
    electronResult: electronClean,
    advisories: adv2,
    existingIssues: [{ number: 12, state: "closed", body: firstPlan.body }],
    observedDate: "2026-11-16"
  });
  assert.equal(closedReopen.action, "create", "旧 GHSA 单已关闭后若出现新 GHSA 必须重新开单");

  // 多页分页：第 1 页全是跨大版本/预发布，第 2 页才出现同大版本补丁与当前版本
  const pages = {
    1: [{ tag_name: "v45.0.1", draft: false, prerelease: false }, { tag_name: "v45.0.0-beta.1", draft: false, prerelease: true }],
    2: [{ tag_name: "v44.9.4", draft: false, prerelease: false }, { tag_name: "v44.9.3", draft: false, prerelease: false }]
  };
  let fetchedPages = 0;
  const rows = await fetchElectronReleasesPaginated("44.9.3", async (page) => { fetchedPages += 1; return pages[page] || []; }, 2, 5);
  assert.equal(fetchedPages, 2);
  assert.equal(rows.some((r) => r.tag_name === "v44.9.4"), true);

  await assert.rejects(
    () => fetchElectronReleasesPaginated("44.9.3", async () => [{ tag_name: "v45.1.0", draft: false, prerelease: false }], 1, 2),
    /electron_releases_incomplete_coverage/
  );
});
