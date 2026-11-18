// desktop/scripts/site-tour.mjs — 开发态九站零打扰只读巡检（可选 --check-menus 做无损菜单读取与原档位恢复校验）。
// 铁律：严禁发送提问、严禁上传附件、严禁改动保存的 18 个档位预设；所有只读回包只含标量与枚举，不含对话或完整 URL。
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertLocalDebugPort,
  classifySiteTarget,
  findShellSession,
  listDebugTargets,
  openCdpTarget,
  readSiteDefinitions,
  reexecUnderLinuxBoundaryIfNeeded,
  verifyDevRuntimeCookieEncryption
} from './lib/dev-tour-client.mjs';

const SCRIPT_PATH = fileURLToPath(import.meta.url);

export function parseTourArgs(argv, allSites = readSiteDefinitions()) {
  const out = { port: 9223, sites: null, checkMenus: false, json: false, skipFuseCheck: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      const val = argv[++i];
      if (val === undefined) throw new Error(`missing_value:${arg}`);
      return val;
    };
    if (arg === '--port') out.port = Number(next());
    else if (arg === '--site' || arg === '--sites') {
      out.sites = next().split(',').map((s) => s.trim()).filter(Boolean);
    } else if (arg === '--check-menus') out.checkMenus = true;
    else if (arg === '--json') out.json = true;
    else throw new Error(`unknown_flag:${arg}`);
  }
  assertLocalDebugPort(out.port);
  if (out.sites) {
    for (const key of out.sites) {
      if (!allSites.some((site) => site.key === key)) throw new Error(`unknown_site:${key}`);
    }
  }
  return out;
}

const ISOLATED_SNAPSHOT_HELPERS = `
  const hashText = (raw) => {
    const s = String(raw || '');
    let h = 2166136261;
    for (let i = 0; i < s.length; i += 1) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return s.length + ':' + (h >>> 0).toString(16);
  };
  const readComposerSig = (S) => {
    const el = typeof S?.findComposer === 'function' ? S.findComposer() : null;
    if (!el) return 'none';
    const val = 'value' in el && typeof el.value === 'string' ? el.value : (el.textContent || '');
    return hashText(val);
  };
  const countOpenMenus = () => [...document.querySelectorAll('[role="menu"], [role="listbox"]')]
    .filter(S.presetDom.visible).length;
`;

export const ISOLATED_TOUR_EXPRESSION = () => `(() => {
  const S = window.__AMS;
  const I = window.__AMS_I18N__;
  if (!S || typeof S.diagnose !== 'function') return { ok: false, code: 'adapter_unavailable' };
  ${ISOLATED_SNAPSHOT_HELPERS}
  const routeShape = location.origin + (location.pathname === '/' ? '/' : '/*') + (location.search ? '?q' : '');
  const beforeHrefSig = hashText(location.href);
  const beforeComposer = readComposerSig(S);
  const beforeMenus = countOpenMenus();

  let rawChecks = [];
  try {
    I?.setLang?.('en');
    rawChecks = S.diagnose() || [];
  } finally {
    const navLang = String(navigator.language || 'en').toLowerCase();
    const restored = navLang === 'zh' || navLang.startsWith('zh-cn') || navLang.startsWith('zh-hans')
      ? 'zhCN'
      : (navLang.startsWith('zh-tw') || navLang.startsWith('zh-hk') || navLang.startsWith('zh-mo') || navLang.startsWith('zh-hant') ? 'zhTW' : 'en');
    I?.setLang?.(restored);
  }
  const checks = Array.isArray(rawChecks) ? rawChecks.map((item, idx) => ({
    name: typeof item?.name === 'string' && /^[\\x20-\\x7e]{1,80}$/.test(item.name) ? item.name : 'check_' + (idx + 1),
    kind: ['reach', 'control', 'tier', 'probe', 'capture'].includes(item?.kind) ? item.kind : 'control',
    ok: Boolean(item?.ok)
  })) : [];

  const adapter = S.pickAdapter?.();
  let observedTier = null;
  try { observedTier = adapter?.state?.() ?? null; } catch { observedTier = 'error'; }
  const presetSupported = Boolean(adapter && (adapter.currentPreset || adapter.readPreset) && adapter.applyPreset && adapter.presetOptions);

  const afterHrefSig = hashText(location.href);
  const afterComposer = readComposerSig(S);
  const afterMenus = countOpenMenus();
  return {
    ok: true,
    routeShape,
    observedTier,
    presetSupported,
    checks,
    baseline: { hrefSig: beforeHrefSig, composer: beforeComposer, menus: beforeMenus },
    invariants: {
      urlUnchanged: beforeHrefSig === afterHrefSig,
      composerUnchanged: beforeComposer === afterComposer,
      menusClosed: afterMenus === 0,
      beforeMenus,
      afterMenus
    }
  };
})()`;

export const ISOLATED_AFTER_MENU_EXPRESSION = (baseline, escFirst = false) => `(() => {
  const S = window.__AMS;
  if (${Boolean(escFirst)}) S?.escMenus?.();
  ${ISOLATED_SNAPSHOT_HELPERS}
  const base = ${JSON.stringify(baseline)};
  const afterHrefSig = hashText(location.href);
  const afterComposer = readComposerSig(S);
  const afterMenus = countOpenMenus();
  return {
    urlUnchanged: base.hrefSig === afterHrefSig,
    composerUnchanged: base.composer === afterComposer,
    menusClosed: afterMenus === 0,
    beforeMenus: base.menus,
    afterMenus
  };
})()`;

export function buildShellMenuTourExpression(siteKey) {
  return `(async () => {
    const site = ${JSON.stringify(siteKey)};
    try {
      const before = await window.polyask.getCurrentTierPreset(site);
      const catalog = await window.polyask.getTierPresets(site);
      const after = await window.polyask.getCurrentTierPreset(site);
      const restored = Boolean(before && after && before.model === after.model && before.effort === after.effort);
      return {
        attempted: true,
        ok: restored && Array.isArray(catalog?.models) && catalog.models.length > 0,
        modelCount: Array.isArray(catalog?.models) ? catalog.models.length : 0,
        effortCount: Array.isArray(catalog?.efforts) ? catalog.efforts.length : 0,
        restored,
        code: restored ? null : 'preset_restore_mismatch'
      };
    } catch (err) {
      const code = String(err?.message || 'menu_tour_failed').slice(0, 48);
      return {
        attempted: true,
        ok: false,
        modelCount: 0,
        effortCount: 0,
        restored: code === 'preset_busy',
        code
      };
    }
  })()`;
}

export function buildShellPresetsExpression(allSites = readSiteDefinitions()) {
  const keys = allSites.flatMap((s) => [`${s.key}FastPreset`, `${s.key}ThinkPreset`]);
  return `window.polyask.getPreferences().then((p) => {
    const v = p?.values ?? p ?? {};
    return JSON.stringify(Object.fromEntries(${JSON.stringify(keys)}.map((k) => [k, v[k] ?? null])));
  })`;
}

export async function runSiteTour(options, deps = {}) {
  const verifyFuse = deps.verifyFuse ?? verifyDevRuntimeCookieEncryption;
  const fetchTargets = deps.listDebugTargets ?? listDebugTargets;
  const openTarget = deps.openCdpTarget ?? openCdpTarget;
  const findShell = deps.findShellSession ?? findShellSession;
  const allSites = deps.sites ?? readSiteDefinitions();

  if (!options.skipFuseCheck) await verifyFuse();
  const targets = await fetchTargets(options.port);
  const selectedSites = options.sites
    ? allSites.filter((site) => options.sites.includes(site.key))
    : allSites;

  const openSessions = new Set();
  const trackOpen = async (wsUrl, port) => {
    const s = await openTarget(wsUrl, port);
    openSessions.add(s);
    return s;
  };

  let shellSession = null;
  const presetsExpr = buildShellPresetsExpression(allSites);
  try {
    shellSession = await findShell(targets, options.port, trackOpen);
    const presetsBefore = await shellSession.evaluate(shellSession.mainId, presetsExpr, { awaitPromise: true });
    const results = [];

    for (const site of selectedSites) {
      const match = classifySiteTarget(targets, site);
      if (match.state !== 'ready') {
        results.push({
          site: site.key,
          state: match.state,
          ok: false,
          checks: [],
          advisoryFails: 0,
          hardFails: 1,
          menuTour: null,
          invariantsOk: true
        });
        continue;
      }
      const pageSession = await trackOpen(match.target.webSocketDebuggerUrl, options.port);
      try {
        if (pageSession.isolatedId === null) {
          results.push({ site: site.key, state: 'no_isolated_context', ok: false, checks: [], advisoryFails: 0, hardFails: 1, menuTour: null, invariantsOk: false });
          continue;
        }
        const probe = await pageSession.evaluate(pageSession.isolatedId, ISOLATED_TOUR_EXPRESSION(), { timeoutMs: 10_000 });
        if (!probe?.ok) {
          results.push({ site: site.key, state: probe?.code || 'probe_failed', ok: false, checks: [], advisoryFails: 0, hardFails: 1, menuTour: null, invariantsOk: false });
          continue;
        }
        const hardFails = probe.checks.filter((c) => !['tier', 'capture'].includes(c.kind) && !c.ok).length;
        const advisoryFails = probe.checks.filter((c) => ['tier', 'capture'].includes(c.kind) && !c.ok).length;
        let menuTour = { attempted: false, ok: true, modelCount: 0, effortCount: 0, restored: true, code: null };
        let invariants = probe.invariants;
        if (options.checkMenus && hardFails === 0 && probe.presetSupported) {
          menuTour = await shellSession.evaluate(
            shellSession.mainId,
            buildShellMenuTourExpression(site.key),
            { awaitPromise: true, timeoutMs: 20_000 }
          );
          invariants = await pageSession.evaluate(
            pageSession.isolatedId,
            ISOLATED_AFTER_MENU_EXPRESSION(probe.baseline, !menuTour?.ok && menuTour?.code !== 'preset_busy'),
            { timeoutMs: 10_000 }
          );
        }
        const invariantsOk = Boolean(invariants?.urlUnchanged && invariants?.composerUnchanged && invariants?.menusClosed);
        const menuOk = !menuTour?.attempted || Boolean(menuTour?.ok && menuTour?.restored);
        const ok = hardFails === 0 && invariantsOk && menuOk;
        results.push({
          site: site.key,
          state: hardFails === 0 ? 'ready' : 'degraded',
          ok,
          observedTier: probe.observedTier,
          checks: probe.checks,
          advisoryFails,
          hardFails,
          menuTour,
          invariants,
          invariantsOk
        });
      } finally {
        pageSession.close();
        openSessions.delete(pageSession);
      }
    }

    const presetsAfter = await shellSession.evaluate(shellSession.mainId, presetsExpr, { awaitPromise: true });
    const presetsUnchanged = presetsBefore === presetsAfter;
    const allOk = presetsUnchanged && results.every((r) => r.ok);
    return {
      ok: allOk,
      checkedAt: new Date().toISOString(),
      checkMenus: Boolean(options.checkMenus),
      presetsUnchanged,
      results
    };
  } finally {
    for (const s of openSessions) s.close();
  }
}

export function formatTourReport(summary) {
  const lines = [
    `PolyAsk Site Tour (${summary.checkedAt}) · menus=${summary.checkMenus ? 'checked' : 'readonly'} · savedPresets=${summary.presetsUnchanged ? 'unchanged' : 'MUTATED!'}`,
    'SITE       STATUS     HARD  ADV  MENUS           INVARIANTS'
  ];
  for (const row of summary.results) {
    const menuCol = !row.menuTour?.attempted
      ? '-'
      : row.menuTour.ok
        ? `ok(${row.menuTour.modelCount}m/${row.menuTour.effortCount}e)`
        : `FAIL:${row.menuTour.code}`;
    const invCol = row.invariantsOk ? 'clean' : 'DIRTY';
    lines.push(
      `${row.site.padEnd(10)} ${String(row.ok ? 'PASS' : row.state).padEnd(10)} ${String(row.hardFails).padEnd(5)} ${String(row.advisoryFails).padEnd(4)} ${menuCol.padEnd(15)} ${invCol}`
    );
  }
  return lines.join('\n');
}

async function main() {
  const boundaryStatus = reexecUnderLinuxBoundaryIfNeeded(SCRIPT_PATH);
  if (boundaryStatus !== null) {
    process.exitCode = boundaryStatus;
    return;
  }
  const options = parseTourArgs(process.argv.slice(2));
  const summary = await runSiteTour(options);
  if (options.json) console.log(JSON.stringify(summary, null, 2));
  else console.log(formatTourReport(summary));
  if (!summary.ok) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === SCRIPT_PATH) {
  main().catch((err) => {
    console.error(`site-tour blocked: ${err.code || err.message}`);
    process.exitCode = 1;
  });
}
