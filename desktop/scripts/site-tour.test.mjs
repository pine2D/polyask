import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';

import {
  assertLocalDebugPort,
  assertLocalWsEndpoint,
  classifySiteTarget,
  openCdpTarget,
  readSiteDefinitions
} from './lib/dev-tour-client.mjs';
import {
  buildShellMenuTourExpression,
  buildShellPresetsExpression,
  formatTourReport,
  ISOLATED_AFTER_MENU_EXPRESSION,
  ISOLATED_TOUR_EXPRESSION,
  parseTourArgs,
  runSiteTour
} from './site-tour.mjs';

const require = createRequire(import.meta.url);
const { replayHtml } = require('./lib/dom-replay.js');

test('debug endpoint guards reject non-local hosts, and openCdpTarget closes socket on handshake failure', async () => {
  assert.throws(() => assertLocalDebugPort(80), /invalid_local_debug_port/);
  assert.throws(() => assertLocalWsEndpoint('ws://192.168.1.9:9223/devtools/page/1', 9223), /nonlocal_debug_endpoint/);
  assert.throws(() => assertLocalWsEndpoint('wss://127.0.0.1:9223/devtools/page/1', 9223), /nonlocal_debug_endpoint/);
  assert.throws(() => assertLocalWsEndpoint('ws://127.0.0.1:9224/devtools/page/1', 9223), /nonlocal_debug_endpoint/);
  assert.equal(assertLocalWsEndpoint('ws://127.0.0.1:9223/devtools/page/1', 9223).hostname, '127.0.0.1');
  assert.deepEqual(parseTourArgs(['--port', '9333', '--site', 'claude,kimi', '--check-menus', '--json']), {
    port: 9333,
    sites: ['claude', 'kimi'],
    checkMenus: true,
    json: true,
    skipFuseCheck: false
  });

  for (const mode of ['error', 'close', 'timeout']) {
    let closeCalls = 0;
    class FailingWebSocket {
      constructor() {
        this.listeners = new Map();
        if (mode !== 'timeout') {
          queueMicrotask(() => {
            for (const fn of this.listeners.get(mode) || []) fn({});
          });
        }
      }
      addEventListener(type, fn) {
        const list = this.listeners.get(type) || [];
        list.push(fn);
        this.listeners.set(type, list);
      }
      close() { closeCalls += 1; }
    }
    await assert.rejects(
      () => openCdpTarget('ws://127.0.0.1:9223/devtools/page/1', 9223, FailingWebSocket, 15),
      mode === 'error' ? /debug_connect_failed/ : mode === 'close' ? /debug_socket_closed/ : /debug_connect_timeout/
    );
    assert.equal(closeCalls, 1, `handshake ${mode} 必须调用 socket.close()`);
  }
});

test('isolated tour + production presetCommand route menu checks through serializeInteraction and restore zh-MO/zh-Hant locale', async () => {
  const secretDraft = '未发送草稿 secret-draft@corp.example';
  const page = `
    <main>
      <div class="chat-input-box">
        <div contenteditable="true" role="textbox" style="height:40px;width:400px">${secretDraft}</div>
        <button type="button" aria-label="Send">Send</button>
      </div>
      <div aria-hidden="true"><div role="menu"></div></div>
      <div hidden><div role="menu"></div></div>
    </main>
  `;
  const live = replayHtml(page, { host: 'www.kimi.com', path: '/chat/secret-uuid-9999?token=sk-abcdefghijklmnop' });
  try {
    let activePreset = { model: 'K2', effort: 'Thinking' };
    let openMenuEl = null;
    let generating = false;
    const langHistory = [];
    const origI18n = live.window.__AMS_I18N__;
    live.window.__AMS_I18N__ = {
      ...origI18n,
      setLang: (lang) => { langHistory.push(lang); origI18n.setLang(lang); }
    };
    Object.defineProperty(live.window.navigator, 'language', { value: 'zh-MO', configurable: true });

    live.window.__AMS.diagnose = () => [
      { name: 'Composer', kind: 'control', ok: true },
      { name: 'Send control', kind: 'control', ok: true },
      { name: 'History capture', kind: 'capture', ok: false }
    ];
    live.window.__AMS.findComposer = () => live.document.querySelector('[role="textbox"]');
    live.window.__AMS.generationProbe = () => (generating ? 'generating' : 'idle');

    const baseAdapter = live.window.__AMS.pickAdapter();
    let menuOpenedCount = 0;
    live.window.__AMS.pickAdapter = () => ({
      ...baseAdapter,
      currentPreset: () => ({ ...activePreset }),
      readPreset: async () => ({ ...activePreset }),
      presetOptions: async (_model, deadline) => live.window.__AMS.withPresetRestored(
        live.window.__AMS.pickAdapter(),
        deadline,
        async () => {
          menuOpenedCount += 1;
          openMenuEl = live.document.createElement('div');
          openMenuEl.setAttribute('role', 'menu');
          live.document.body.appendChild(openMenuEl);
          activePreset = { model: 'K2', effort: 'Fast' };
          return { models: ['K2'], model: 'K2', efforts: ['Thinking', 'Fast'], current: { model: 'K2', effort: 'Thinking' }, primary: 'model', secondary: 'effort' };
        }
      ),
      applyPreset: async (preset) => {
        activePreset = { ...preset };
        return { ...activePreset };
      }
    });
    const origEsc = live.window.__AMS.escMenus?.bind(live.window.__AMS);
    live.window.__AMS.escMenus = () => {
      origEsc?.();
      if (openMenuEl) { openMenuEl.remove(); openMenuEl = null; }
    };

    const ctx = live.dom.getInternalVMContext();
    // 隐藏祖先下的常驻菜单可以有布局；可见的残留菜单仍须报错。
    for (const el of live.document.querySelectorAll('[role="menu"]')) el.getClientRects = () => [{ width: 200, height: 40 }];
    const probe = JSON.parse(JSON.stringify(vm.runInContext(ISOLATED_TOUR_EXPRESSION(), ctx)));
    assert.equal(probe.ok, true);
    assert.equal(probe.presetSupported, true);
    assert.deepEqual(langHistory, ['en', 'zhTW'], 'zh-MO/zh-Hant 必须按 resolveLocale 恢复为 zhTW');

    const shellCtx = vm.createContext({
      window: {
        polyask: {
          getCurrentTierPreset: async () => {
            const res = await live.send({ source: 'AMS', cmd: 'tierPreset', action: { kind: 'current' }, deadline: Date.now() + 5000 });
            if (!res.ok) throw new Error(res.code);
            return res.current;
          },
          getTierPresets: async () => {
            const res = await live.send({ source: 'AMS', cmd: 'tierPreset', action: { kind: 'options' }, deadline: Date.now() + 8000 });
            if (!res.ok) throw new Error(res.code);
            return res.catalog;
          }
        }
      }
    });

    // 1. 生成中（preset_busy）必须直接拒止，严禁点开菜单
    generating = true;
    const busyTour = JSON.parse(JSON.stringify(await vm.runInContext(buildShellMenuTourExpression('kimi'), shellCtx)));
    assert.equal(busyTour.ok, false);
    assert.equal(busyTour.code, 'preset_busy');
    assert.equal(busyTour.restored, true);
    assert.equal(menuOpenedCount, 0, 'preset_busy 时严禁触碰页面菜单');

    // 2. 空闲时走生产 presetCommand 队列读取并恢复原档位
    generating = false;
    const menuTour = JSON.parse(JSON.stringify(await vm.runInContext(buildShellMenuTourExpression('kimi'), shellCtx)));
    assert.equal(menuTour.attempted, true);
    assert.equal(menuTour.ok, true);
    assert.equal(menuTour.restored, true);
    assert.equal(menuOpenedCount, 1);
    assert.deepEqual(activePreset, { model: 'K2', effort: 'Thinking' }, '巡检后必须恢复原档位');

    const invariants = JSON.parse(JSON.stringify(vm.runInContext(ISOLATED_AFTER_MENU_EXPRESSION(probe.baseline, false), ctx)));
    assert.equal(invariants.urlUnchanged, true);
    assert.equal(invariants.composerUnchanged, true);
    assert.equal(invariants.menusClosed, true);
    const leftover = live.document.createElement('div'); leftover.setAttribute('role', 'listbox');
    leftover.getClientRects = () => [{ width: 200, height: 40 }]; live.document.body.append(leftover);
    const dirty = vm.runInContext(ISOLATED_AFTER_MENU_EXPRESSION(probe.baseline, false), ctx);
    assert.equal(dirty.afterMenus, 1); assert.equal(dirty.menusClosed, false);
    assert.doesNotMatch(JSON.stringify({ probe, menuTour, invariants }), /secret-draft|corp\.example|sk-abcdef/);
  } finally {
    live.close();
  }
});

test('runSiteTour projects all 18 flat preset keys, detects single-key mutation, and closes all sockets', async () => {
  const allRealSites = readSiteDefinitions();
  const prefValues = Object.fromEntries(
    allRealSites.flatMap((s) => [
      [`${s.key}FastPreset`, { model: `${s.key}-fast`, effort: null }],
      [`${s.key}ThinkPreset`, { model: `${s.key}-think`, effort: 'high' }]
    ])
  );
  const vmPrefsCtx = vm.createContext({
    window: { polyask: { getPreferences: async () => ({ values: prefValues }) } }
  });
  const snap1 = await vm.runInContext(buildShellPresetsExpression(allRealSites), vmPrefsCtx);
  assert.equal(Object.keys(JSON.parse(snap1)).length, 18, '必须覆盖九站共 18 个扁平预设键');

  const sites = [
    { key: 'claude', host: 'claude.ai', authHosts: [] },
    { key: 'gemini', host: 'gemini.google.com', authHosts: ['accounts.google.com'] },
    { key: 'kimi', host: 'www.kimi.com', authHosts: [] }
  ];
  const targets = [
    { type: 'page', url: 'http://localhost:3000/main_window', webSocketDebuggerUrl: 'ws://127.0.0.1:9223/devtools/page/shell' },
    { type: 'page', url: 'https://claude.ai/new', webSocketDebuggerUrl: 'ws://127.0.0.1:9223/devtools/page/claude' },
    { type: 'page', url: 'https://accounts.google.com/signin', webSocketDebuggerUrl: 'ws://127.0.0.1:9223/devtools/page/gemini-auth' }
  ];
  assert.equal(classifySiteTarget(targets, sites[0]).state, 'ready');
  assert.equal(classifySiteTarget(targets, sites[1]).state, 'sign_in');
  assert.equal(classifySiteTarget(targets, sites[2]).state, 'missing');

  let mutatePresetOnAfter = false;
  let closedCount = 0;
  let openedCount = 0;
  let prefReads = 0;

  const runOnce = async () => runSiteTour(
    { port: 9223, sites: ['claude'], checkMenus: true },
    {
      sites,
      verifyFuse: async () => {},
      listDebugTargets: async () => targets,
      openCdpTarget: async (wsUrl) => {
        openedCount += 1;
        const isShell = wsUrl.endsWith('/shell');
        const shellVm = vm.createContext({
          window: {
            polyask: {
              getPreferences: async () => {
                prefReads += 1;
                return {
                  values: {
                    claudeFastPreset: { model: 'Haiku', effort: null },
                    claudeThinkPreset: { model: mutatePresetOnAfter && prefReads % 2 === 0 ? 'Opus-Mutated' : 'Sonnet', effort: 'High' }
                  }
                };
              },
              getCurrentTierPreset: async () => ({ model: 'Sonnet', effort: 'High' }),
              getTierPresets: async () => ({ models: ['Sonnet', 'Haiku'], efforts: ['High', 'Normal'] })
            }
          }
        });
        return {
          mainId: 1,
          isolatedId: isShell ? null : 2,
          evaluate: async (_ctx, expr) => {
            if (isShell) return vm.runInContext(expr, shellVm);
            if (expr.includes('urlUnchanged: base.hrefSig')) {
              return { urlUnchanged: true, composerUnchanged: true, menusClosed: true, beforeMenus: 0, afterMenus: 0 };
            }
            return {
              ok: true,
              observedTier: 'think',
              presetSupported: true,
              checks: [{ name: 'Composer', kind: 'control', ok: true }, { name: 'Capture', kind: 'capture', ok: false }],
              baseline: { hrefSig: '18:1', composer: '0:0', menus: 0 },
              invariants: { urlUnchanged: true, composerUnchanged: true, menusClosed: true, beforeMenus: 0, afterMenus: 0 }
            };
          },
          close: () => { closedCount += 1; }
        };
      }
    }
  );

  const cleanSummary = await runOnce();
  assert.equal(cleanSummary.ok, true);
  assert.equal(cleanSummary.presetsUnchanged, true);
  assert.equal(cleanSummary.results[0].menuTour.ok, true);
  assert.match(formatTourReport(cleanSummary), /claude\s+PASS/);

  mutatePresetOnAfter = true;
  const mutatedSummary = await runOnce();
  assert.equal(mutatedSummary.presetsUnchanged, false, '任一扁平预设键被篡改必须判定 presetsUnchanged=false');
  assert.equal(mutatedSummary.ok, false);
  assert.equal(openedCount, closedCount, '所有打开的调试会话必须全部关闭');
});
