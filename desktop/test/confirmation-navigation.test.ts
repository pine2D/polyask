import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { dispatchAppCommand } from '../src/main/app-command-dispatch';

const base = resolve(__dirname, '..');
const req = createRequire(`${base}/src/main/view-manager.ts`);
const { transformSync } = req('esbuild');

function harness() {
  const attached = new Set<any>(), views: any[] = [], layouts: any[] = [];
  let nextId = 1;
  const window = Object.assign(new EventEmitter(), {
    isDestroyed: () => false, isMinimized: () => false, getContentSize: () => [2560, 1378],
    getNormalBounds: () => ({ x: 0, y: 0, width: 2560, height: 1378 }), isMaximized: () => false,
    contentView: { get children() { return [...attached]; },
      addChildView(view: any) { attached.add(view); }, removeChildView(view: any) { attached.delete(view); } },
    webContents: Object.assign(new EventEmitter(), { getZoomFactor: () => 1, focus: () => {}, send: () => {} })
  });
  const module = { exports: {} as any };
  runInNewContext(transformSync(readFileSync(`${base}/src/main/view-manager.ts`, 'utf8'),
    { loader: 'ts', format: 'cjs' }).code, {
    module, exports: module.exports, setTimeout, clearTimeout,
    require: (name: string) => {
      if (name === 'electron') return { session: { fromPartition: () => ({
        setPermissionCheckHandler() {}, setPermissionRequestHandler() {} }) } };
      if (name === './site-view') return { createSiteView: () => {
        const id = nextId++, calls: string[] = [];
        let zoom = 1, destroyed = false, visible = true, historyIndex = 1;
        const contents = Object.assign(new EventEmitter(), {
          id, calls, isDestroyed: () => destroyed, close: () => { destroyed = true; },
          loadURL: async () => {}, focus: () => calls.push('focus'), stop() {},
          getURL: () => 'https://claude.ai/new',
          navigationHistory: { canGoBack: () => historyIndex > 0, canGoForward: () => historyIndex < 1,
            goBack: () => { historyIndex--; calls.push('goBack'); },
            goForward: () => { historyIndex++; calls.push('goForward'); } },
          setZoomMode() {}, getZoomFactor: () => zoom, setZoomFactor: (value: number) => { zoom = value; },
          historyIndex: () => historyIndex
        });
        const view = { setVisible: (value: boolean) => { visible = value; }, getVisible: () => visible,
          setBounds() {}, webContents: contents };
        views.push(view); return view;
      } };
      return req(name);
    }
  });
  const manager = new module.exports.ViewManager(window, () => {}, (layout: unknown) => layouts.push(layout), undefined,
    { selectedSites: ['claude', 'chatgpt', 'gemini', 'deepseek', 'kimi'] });
  for (const view of views) view.webContents.emit('did-navigate', {}, 'https://example.invalid/', 200, 'OK');
  manager.markStatus({ site: 'claude', phase: 'ready' });
  return { manager, window, attached, views, layouts };
}

test('confirmation blocks direct page, relative focus and history navigation without releasing native cover', () => {
  const h = harness();
  try {
    h.manager.setSurface('confirmation');
    h.manager.pageDirect(1); h.manager.pageRelative(1); h.manager.setPage(1); h.manager.focusRelative(1);
    assert.equal(h.manager.getLayout().page, 0); assert.equal(h.manager.getLayout().focused, 'claude');
    assert.equal(h.manager.getUiState().layoutMode, 'overview');
    assert.equal(h.manager.navigateHistory('claude', -1), false);
    assert.equal(h.views[0].webContents.historyIndex(), 1);
    assert.equal(h.views.some(view => view.webContents.calls.includes('focus')), false);
    assert.equal(h.attached.size, 5); assert.equal(h.views.every(view => !view.getVisible()), true);
  } finally { h.window.emit('closed'); }
});

test('native menu commands neither dispatch nor move shell focus while confirmation owns the window', () => {
  const h = harness();
  let shellFocus = 0, commandEvents = 0;
  h.window.webContents.focus = () => { shellFocus++; };
  h.window.webContents.send = () => { commandEvents++; };
  try {
    h.manager.setSurface('confirmation');
    for (const id of ['show-page-2', 'next-page', 'next-site', 'site-back', 'focus-prompt', 'edit-prompt', 'focus-current-site', 'open-settings', 'new-session',
      'open-command-palette', 'open-shortcuts', 'open-getting-started'] as const) {
      dispatchAppCommand(id, h.manager, h.window as any);
    }
    assert.equal(shellFocus, 0); assert.equal(commandEvents, 0);
    assert.equal(h.manager.getLayout().page, 0); assert.equal(h.manager.getLayout().focused, 'claude');
    h.manager.setSurface('sites'); dispatchAppCommand('focus-prompt', h.manager, h.window as any);
    assert.equal(shellFocus, 1); assert.equal(commandEvents, 1);
  } finally { h.window.emit('closed'); }
});

test('native panel commands preserve source focus until the surface transition is accepted', () => {
  const h = harness(), events: string[] = [];
  h.window.webContents.focus = () => { events.push('focus-shell'); };
  h.window.webContents.send = (_channel?: string, id?: string) => { events.push(id!); };
  try {
    for (const id of ['open-command-palette', 'open-shortcuts', 'open-getting-started'] as const) {
      events.length = 0;
      dispatchAppCommand(id, h.manager, h.window as any);
      assert.deepEqual(events, [id]);
    }
  } finally { h.window.emit('closed'); }
});

test('settings retains background page changes while hidden views never steal native focus', () => {
  const h = harness();
  try {
    h.manager.setSurface('settings');
    h.manager.pageDirect(1); assert.equal(h.manager.getLayout().page, 1);
    h.manager.pageRelative(1); assert.equal(h.manager.getLayout().page, 0);
    h.manager.focusRelative(1); assert.equal(h.manager.getLayout().focused, 'chatgpt');
    assert.equal(h.views.some(view => view.webContents.calls.includes('focus')), false);
    assert.equal(h.attached.size, 0);
    h.manager.setSurface('sites'); h.manager.focusRelative(1);
    assert.equal(h.views.some(view => view.webContents.calls.includes('focus')), true);
  } finally { h.window.emit('closed'); }
});

test('explicit retry inspection can locate while covered and focuses only after native views are restored', () => {
  const h = harness();
  try {
    h.manager.setSurface('confirmation');
    assert.equal(h.manager.setLayout('focus', 'chatgpt'), true);
    assert.equal(h.views.some(view => view.webContents.calls.includes('focus')), false);
    h.manager.setSurface('sites');
    assert.equal(h.manager.setLayout('focus', 'chatgpt'), true);
    assert.equal(h.views[1].webContents.calls.filter((call: string) => call === 'focus').length, 1);
  } finally { h.window.emit('closed'); }
});


test('focusing the current site preserves overview, page and order and refuses covered views', () => {
  const h = harness();
  try {
    h.manager.setPage(1);
    const before = JSON.stringify(h.manager.getUiState());
    const current = h.manager.getLayout().focused;
    h.manager.focusCurrentSite();
    assert.equal(JSON.stringify(h.manager.getUiState()), before);
    assert.equal(h.views[3].webContents.calls.includes('focus'), true);
    assert.equal(h.manager.getLayout().focused, current);
    for (const surface of ['settings', 'confirmation', 'question-history']) {
      h.manager.setSurface(surface);
      const count = h.views.reduce((n: number, v: any) => n + v.webContents.calls.length, 0);
      h.manager.focusCurrentSite();
      assert.equal(h.views.reduce((n: number, v: any) => n + v.webContents.calls.length, 0), count);
    }
  } finally { h.window.emit('closed'); }
});


test('current site follows native focus in overview and ignores covered or off-page views', () => {
  const h = harness();
  try {
    h.views[1].webContents.emit('focus');
    assert.equal(h.manager.getLayout().focused, 'chatgpt');
    assert.equal(h.manager.getUiState().layoutMode, 'overview');
    h.views[4].webContents.emit('focus');
    assert.equal(h.manager.getLayout().focused, 'chatgpt');
    h.manager.setSurface('confirmation'); h.views[0].webContents.emit('focus');
    assert.equal(h.manager.getLayout().focused, 'chatgpt');
  } finally { h.window.emit('closed'); }
});
