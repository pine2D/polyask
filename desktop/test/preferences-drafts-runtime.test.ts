import assert from 'node:assert/strict';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { transformSync } from 'esbuild';
import { DesktopDatabase } from '../src/main/database';
import { DraftRepository } from '../src/main/draft-repository';
import { PreferencesRepository } from '../src/main/preferences-repository';
import { PreferenceRuntime } from '../src/main/preference-runtime';
import { SiteZoomController } from '../src/main/site-zoom';
import * as draftContract from '../src/shared/drafts';
import * as preferenceContract from '../src/shared/preferences';
import type { DesktopUiState } from '../src/shared/desktop-ui-state';
import type { DisplayPreferences } from '../src/shared/display';
import { readSource } from './fixtures';

function setup() {
  const db = DesktopDatabase.open(':memory:');
  db.meta.put('deviceId', 'local');
  const preferences = new PreferencesRepository(db.state, db.meta, { now: () => 100 });
  const drafts = new DraftRepository(db.state, db.meta, { now: () => 100, createId: () => 'own-draft' });
  const listeners = new Map<string, (...args: any[]) => void>();
  let factor = 1, runtime: PreferenceRuntime | undefined;
  const native = { setZoomMode: () => {}, on: (event: string, callback: (...args: any[]) => void) => listeners.set(event, callback),
    once: () => {}, isDestroyed: () => false, getZoomFactor: () => factor, setZoomFactor: (value: number) => { factor = value; } };
  let ui: DesktopUiState = { maximized: false, layoutMode: 'overview', currentPage: 1,
    focusedByPage: { 0: 'claude', 1: 'kimi' }, siteZoom: { claude: 0.75 } };
  const zoom = new SiteZoomController(() => runtime?.captureUi(manager.getUiState()));
  zoom.restore(ui.siteZoom); zoom.bind('claude', native as any);
  const layouts: Array<{ mode: string; focused: string; activate: boolean }> = [];
  const displays: DisplayPreferences[] = [], notices: boolean[] = [], published: preferenceContract.PreferenceSnapshot[] = [];
  const manager = { siteZoom: zoom, getUiState: () => ({ ...ui, siteZoom: zoom.snapshot() }),
    getLayout: () => ({ mode: ui.layoutMode, focused: 'kimi', page: 1 }),
    setLayout: (mode: 'overview' | 'focus', focused: string, activate: boolean) => {
      layouts.push({ mode, focused, activate }); ui = { ...ui, layoutMode: mode };
      runtime?.captureUi(manager.getUiState()); return true;
    } };
  runtime = new PreferenceRuntime(preferences, drafts, manager as any, value => published.push(value), value => {
    displays.push(value); zoom.apply('claude', native as any, value.siteScale); runtime?.captureUi(manager.getUiState());
  }, value => notices.push(value));
  return { db, preferences, drafts, runtime, layouts, displays, notices, published, zoom, factor: () => factor,
    nativeZoom: (direction: 'in' | 'out') => listeners.get('zoom-changed')!({}, direction),
    nativeReset: () => listeners.get('before-input-event')!({ preventDefault: () => {} },
      { type: 'keyDown', key: '0', control: true, meta: false, alt: false }) };
}

test('runtime initializes from local layout and zoom without focusing a site or writing shared defaults', () => {
  const s = setup();
  try {
    assert.deepEqual(s.layouts, [{ mode: 'overview', focused: 'kimi', activate: false }]);
    assert.equal(s.factor(), 0.75);
    assert.equal(s.runtime.snapshot().following.layout, false);
    assert.deepEqual(s.runtime.snapshot().values.siteZoom, { claude: 0.75 });
    assert.equal(s.db.state.entries('preference:').length, 0);
    assert.equal(s.db.outbox.count(), 0);
  } finally { s.db.close(); }
});

test('cloud refresh applies native zoom and layout without changing the focused site or autosaving feedback', () => {
  const s = setup();
  try {
    s.db.state.put('preference:layoutMode', { value: 'focus', updatedAt: 200, deviceId: 'remote' }, 200, false);
    s.db.state.put('preference:siteZoom.claude', { value: 2, updatedAt: 200, deviceId: 'remote' }, 200, false);
    s.db.state.put('preference:completionNotifications', { value: true, updatedAt: 200, deviceId: 'remote' }, 200, false);
    s.preferences.setFollowing('layout', true); s.preferences.setFollowing('siteZoom', true);
    const before = s.db.outbox.count();
    s.runtime.refresh();
    assert.equal(s.factor(), 2);
    assert.deepEqual(s.layouts.at(-1), { mode: 'focus', focused: 'kimi', activate: false });
    assert.equal(s.notices.at(-1), true);
    assert.equal(s.db.outbox.count(), before);
    assert.deepEqual(s.db.state.get('preference:siteZoom.claude'), { value: 2, updatedAt: 200, deviceId: 'remote' });
    const applications = s.layouts.length;
    s.runtime.refresh();
    assert.equal(s.layouts.length, applications);
  } finally { s.db.close(); }
});

test('native zoom edits respect follow mode and reset persists an explicit shared zoom', () => {
  const s = setup();
  try {
    s.nativeZoom('in');
    assert.equal(s.factor(), 0.8);
    assert.equal(s.runtime.snapshot().values.siteZoom.claude, 0.8);
    assert.equal(s.db.state.get('preference:siteZoom.claude'), null);
    s.runtime.follow('siteZoom', true);
    s.nativeZoom('in');
    assert.deepEqual(s.db.state.get('preference:siteZoom.claude'), { value: 0.9, updatedAt: 101, deviceId: 'local' });
    s.nativeReset();
    assert.equal(s.factor(), 1);
    assert.deepEqual(s.db.state.get('preference:siteZoom.claude'), { value: 1, updatedAt: 102, deviceId: 'local' });
    assert.deepEqual(s.layouts, [{ mode: 'overview', focused: 'kimi', activate: false }]);
  } finally { s.db.close(); }
});

function register(runtime: PreferenceRuntime) {
  const handlers = new Map<string, (event: unknown, value?: unknown) => any>();
  const module = { exports: {} as { registerPreferencesDraftsIpc: (options: unknown) => () => void } };
  runInNewContext(transformSync(readSource('src/main/preferences-drafts-ipc.ts'), { loader: 'ts', format: 'cjs' }).code, {
    module, exports: module.exports, require: (name: string) => {
      if (name === '../shared/drafts') return draftContract;
      if (name === '../shared/preferences') return preferenceContract;
      assert.equal(name, 'electron');
      return { ipcMain: { handle: (key: string, action: any) => handlers.set(key, action), removeHandler: (key: string) => handlers.delete(key) } };
    }
  });
  let notifications = 0;
  const dispose = module.exports.registerPreferencesDraftsIpc({ runtime, trusted: (event: unknown) => event === true,
    publishDrafts: () => notifications++ });
  return { handlers, dispose, notifications: () => notifications };
}

test('all preference and draft IPC routes reject untrusted origins before inspecting or mutating payloads', () => {
  const s = setup(), ipc = register(s.runtime);
  try {
    assert.equal(ipc.handlers.size, 8);
    const before = { state: s.db.state.entries('preference:'), meta: s.db.meta.get('devicePreferences'), published: s.published.length };
    for (const handler of ipc.handlers.values()) assert.throws(() => handler(false, null), /untrusted_sender/);
    assert.deepEqual({ state: s.db.state.entries('preference:'), meta: s.db.meta.get('devicePreferences'), published: s.published.length }, before);
    assert.equal(s.drafts.list().length, 0);
    assert.equal(ipc.notifications(), 0);
  } finally { ipc.dispose(); s.db.close(); }
  assert.equal(ipc.handlers.size, 0);
});

test('draft IPC requires valid epochs and rejects delayed saves and deletions after a reset lifecycle', () => {
  const s = setup(), ipc = register(s.runtime);
  try {
    const invoke = (channel: string, value?: unknown) => ipc.handlers.get(`polyask:${channel}`)!(true, value);
    const input = { kind: 'prompt', context: 'prompt', title: '', content: { text: 'An old edit' } };
    const list = invoke('draft-list', { kind: 'prompt', context: 'prompt' });
    assert.equal(list.epoch, 0);
    assert.equal(list.deviceId, 'local');
    for (const epoch of [undefined, -1, 0.1, '0', null]) assert.throws(() => invoke('draft-save', { input, epoch }), /invalid_request/);
    const saved = invoke('draft-save', { input, epoch: list.epoch });
    assert.equal(saved.id, 'own-draft');
    s.db.resetLocalData(); s.runtime.reset();
    assert.throws(() => invoke('draft-save', { input, epoch: list.epoch }), /stale_draft_context/);
    assert.throws(() => invoke('draft-remove', { id: saved.id, updatedAt: saved.updatedAt, epoch: list.epoch }), /stale_draft_context/);
    assert.equal(s.drafts.list().length, 0);
    assert.equal(s.db.outbox.count(), 0);
    assert.equal(ipc.notifications(), 1);
    assert.equal(invoke('draft-list').epoch, 1);
  } finally { ipc.dispose(); s.db.close(); }
});

test('draft list IPC accepts the same Unicode context length as draft save', () => {
  const s = setup(), ipc = register(s.runtime);
  try {
    const context = '🙂'.repeat(300);
    ipc.handlers.get('polyask:draft-save')!(true, { epoch: 0,
      input: { kind: 'comparison', context, title: 'Unicode source', content: { notes: 'Keep this branch' } } });
    const result = ipc.handlers.get('polyask:draft-list')!(true, { kind: 'comparison', context });
    assert.equal(result.drafts.length, 1);
    assert.equal(result.drafts[0].context, context);
  } finally { ipc.dispose(); s.db.close(); }
});
