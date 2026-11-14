#!/usr/bin/env node
"use strict";
// scripts/watch-security.js — 底层安全与运行时版本周检哨兵。
// 每周一（及手动触发）检查：
//   1. Electron 同大版本稳定补丁（默认遵守 UPDATE_MIN_AGE_DAYS=3 即 72 小时等待期）；
//   2. desktop/ 生产依赖（--omit=dev）与随包 Electron 运行时包中的 high/critical 漏洞。
// 无风险或补丁仍在 72 小时冷却期时零打扰（不开 issue）；发现风险时合并为单条 [security-watch] issue。

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const {
  SECURITY_LABEL,
  DEFAULT_MIN_AGE_DAYS,
  parseStableSemver,
  compareSemver,
  evaluateElectronReleases,
  parseNpmAuditJson,
  extractProdPackageNames,
  collectRuntimeAdvisories,
  planSecurityIssue
} = require("./lib/security-sentinel.js");

const DESKTOP_DIR = path.join(__dirname, "..", "desktop");
const ELECTRON_RELEASES_BASE_URL = "https://api.github.com/repos/electron/electron/releases";
const ELECTRON_PAGE_SIZE = 100;
const ELECTRON_MAX_PAGES = 5;

function runNpmAuditOnce(extraArgs) {
  try {
    return execFileSync("npm", ["audit", "--package-lock-only", ...extraArgs, "--json"], {
      cwd: DESKTOP_DIR,
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024
    });
  } catch (err) {
    if (typeof err.stdout === "string" && err.stdout.trim()) return err.stdout;
    throw new Error(`npm audit failed without stdout: ${err.message}`);
  }
}

async function runNpmAuditWithRetry(extraArgs, attempts = 3) {
  let lastError;
  for (let i = 1; i <= attempts; i += 1) {
    try {
      return parseNpmAuditJson(runNpmAuditOnce(extraArgs));
    } catch (err) {
      lastError = err;
      if (i < attempts) await new Promise((resolve) => setTimeout(resolve, 3_000));
    }
  }
  throw lastError;
}

async function fetchJsonWithRetry(url, token, retry = 1) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 30_000);
  try {
    const headers = {
      accept: "application/vnd.github+json",
      "user-agent": "polyask-security-watch",
      "x-github-api-version": "2022-11-28",
      ...(token ? { authorization: `Bearer ${token}` } : {})
    };
    const res = await fetch(url, { headers, redirect: "follow", signal: ctl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return await res.json();
  } catch (err) {
    if (retry <= 0) throw err;
    await new Promise((resolve) => setTimeout(resolve, 3_000));
    return fetchJsonWithRetry(url, token, retry - 1);
  } finally {
    clearTimeout(timer);
  }
}

function createGitHubClient(repo, token) {
  return async function github(method, apiPath, body, allow422 = false) {
    const res = await fetch(`https://api.github.com/repos/${repo}${apiPath}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/vnd.github+json",
        "user-agent": "polyask-security-watch",
        "x-github-api-version": "2022-11-28",
        ...(body ? { "content-type": "application/json" } : {})
      },
      body: body ? JSON.stringify(body) : undefined
    });
    if (allow422 && res.status === 422) return null;
    if (!res.ok) throw new Error(`GitHub API ${method} ${apiPath}: HTTP ${res.status}`);
    return res.json();
  };
}

async function fetchElectronReleasesPaginated(currentVersion, fetchPage, pageSize = ELECTRON_PAGE_SIZE, maxPages = ELECTRON_MAX_PAGES) {
  const current = parseStableSemver(currentVersion);
  if (!current) throw new Error(`invalid_current_electron:${currentVersion}`);
  const all = [];
  for (let page = 1; page <= maxPages; page += 1) {
    const rows = await fetchPage(page, pageSize);
    if (!Array.isArray(rows)) throw new Error("electron_releases_invalid");
    all.push(...rows);
    const reachedCurrent = rows.some((row) => {
      if (!row || row.draft === true || row.prerelease === true) return false;
      const parsed = parseStableSemver(row.tag_name || row.name);
      return Boolean(parsed && parsed.major === current.major && compareSemver(parsed, current) <= 0);
    });
    if (reachedCurrent || rows.length < pageSize) return all;
  }
  throw new Error("electron_releases_incomplete_coverage");
}

async function listSecurityIssues(github) {
  const all = [];
  for (let page = 1; page <= 10; page += 1) {
    const rows = await github("GET", `/issues?labels=${SECURITY_LABEL}&state=all&per_page=100&page=${page}`);
    if (!Array.isArray(rows)) throw new Error("security_issues_response_invalid");
    all.push(...rows.filter((row) => !row.pull_request));
    if (rows.length < 100) return all;
  }
  throw new Error("security_issues_pagination_overflow");
}

async function runSecurityWatch(options = {}) {
  const log = options.log || console.log;
  const now = options.now instanceof Date ? options.now : new Date();
  const minAgeDays = options.minAgeDays !== undefined
    ? Number(options.minAgeDays)
    : process.env.UPDATE_MIN_AGE_DAYS !== undefined
      ? Number(process.env.UPDATE_MIN_AGE_DAYS)
      : DEFAULT_MIN_AGE_DAYS;
  const verbose = options.verbose !== undefined ? Boolean(options.verbose) : process.argv.includes("--verbose");
  const dryRun = options.dryRun !== undefined
    ? Boolean(options.dryRun)
    : process.argv.includes("--dry-run") || !process.env.GITHUB_TOKEN || !process.env.GITHUB_REPOSITORY;

  const pkg = options.desktopPkg || JSON.parse(fs.readFileSync(path.join(DESKTOP_DIR, "package.json"), "utf8"));
  const lock = options.desktopLock || JSON.parse(fs.readFileSync(path.join(DESKTOP_DIR, "package-lock.json"), "utf8"));
  const currentElectron = String((pkg.devDependencies && pkg.devDependencies.electron) || (pkg.dependencies && pkg.dependencies.electron) || "");
  const prodPackageNames = extractProdPackageNames(lock);

  const releases = options.fetchElectronReleases
    ? await options.fetchElectronReleases()
    : await fetchElectronReleasesPaginated(
      currentElectron,
      (page, pageSize) => fetchJsonWithRetry(`${ELECTRON_RELEASES_BASE_URL}?per_page=${pageSize}&page=${page}`, process.env.GITHUB_TOKEN || ""),
      options.electronPageSize || ELECTRON_PAGE_SIZE,
      options.electronMaxPages || ELECTRON_MAX_PAGES
    );
  const [prodAudit, fullAudit] = options.readAudits
    ? await options.readAudits()
    : await Promise.all([runNpmAuditWithRetry(["--omit=dev"]), runNpmAuditWithRetry([])]);

  const electronResult = evaluateElectronReleases({
    currentVersion: currentElectron,
    releases,
    nowMs: now.getTime(),
    minAgeDays
  });
  const advisories = collectRuntimeAdvisories({ prodAudit, fullAudit, prodPackageNames });

  if (!electronResult.eligible && advisories.length === 0) {
    if (verbose) {
      if (electronResult.coolingDown.length > 0) {
        log(`[security-watch] cooling down (<${minAgeDays}d): ${electronResult.coolingDown.map((c) => `v${c.version}(${c.ageHours}h)`).join(", ")}`);
      }
      log(`[security-watch] clean (Electron ${electronResult.current}, 0 runtime high/critical advisories)`);
    }
    return { electronResult, advisories, plan: { action: "none", fingerprint: null } };
  }

  const github = options.github
    || (process.env.GITHUB_TOKEN && process.env.GITHUB_REPOSITORY
      ? createGitHubClient(process.env.GITHUB_REPOSITORY, process.env.GITHUB_TOKEN)
      : null);
  const existingIssues = github ? await listSecurityIssues(github) : [];
  const plan = planSecurityIssue({
    electronResult,
    advisories,
    existingIssues,
    observedDate: now.toISOString().slice(0, 10)
  });

  if (verbose && electronResult.coolingDown.length > 0) {
    log(`[security-watch] cooling down (<${minAgeDays}d): ${electronResult.coolingDown.map((c) => `v${c.version}(${c.ageHours}h)`).join(", ")}`);
  }
  if (plan.action === "noop") {
    log(`[security-watch] already reported in #${plan.issueNumber} (fingerprint=${plan.fingerprint})`);
    return { electronResult, advisories, plan };
  }
  if (dryRun || !github) {
    log(`[dry-run] would ${plan.action}: ${plan.title}`);
    return { electronResult, advisories, plan };
  }

  await github("POST", "/labels", {
    name: SECURITY_LABEL,
    color: "b60205",
    description: "Electron 同大版本补丁与生产运行时高危安全周检提醒"
  }, true);

  if (plan.action === "update") {
    await github("PATCH", `/issues/${plan.issueNumber}`, { title: plan.title, body: plan.body });
    log(`[security-watch] updated #${plan.issueNumber}: ${plan.title}`);
  } else {
    const created = await github("POST", "/issues", { title: plan.title, body: plan.body, labels: [SECURITY_LABEL] });
    log(`[security-watch] opened #${created.number}: ${plan.title}`);
  }
  return { electronResult, advisories, plan };
}

module.exports = { runSecurityWatch, fetchElectronReleasesPaginated };

if (require.main === module) {
  runSecurityWatch().catch((err) => {
    console.error(`✗ security-watch failed: ${err.message}`);
    process.exitCode = 1;
  });
}
