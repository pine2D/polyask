import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { SiteFindController } from '../src/main/site-find';
import { parseSiteFindRequest, SITE_FIND_HEIGHT } from '../src/shared/site-find';
import { commandAccelerator, commandAliasForInput, type CommandId } from '../src/shared/commands';
import { computeWorkspaceLayout } from '../src/main/workspace-layout';
import type { SiteKey } from '../src/shared/contracts';
import { registerSiteFindIpc } from '../src/main/site-find-ipc';

function page(id: number) {
  let next = 0, destroyed = false;
  const calls: { id: number; query: string; options: { forward?: boolean; findNext?: boolean } }[] = [];
  const stopped: string[] = [];
  const contents = Object.assign(new EventEmitter(), {
    id, isDestroyed: () => destroyed,
    findInPage(query: string, options: { forward?: boolean; findNext?: boolean }) {
      calls.push({ id: ++next, query, options }); return next;
    },
    stopFindInPage(action: string) { stopped.push(action); },
    result(matches: number, active = matches ? 1 : 0, requestId = next, finalUpdate = true) {
      contents.emit('found-in-page', {}, { requestId, matches, activeMatchOrdinal: active, finalUpdate });
    },
    destroy() { destroyed = true; contents.emit('destroyed'); }
  });
  return { contents, calls, stopped };
}
function harness() {
  const claude = page(1), chatgpt = page(2), kimi = page(3);
  let focused: SiteKey = 'claude', allowed = true, reserves = 0, restored = 0;
  let targets = [{ site: 'claude' as SiteKey, contents: claude.contents },
    { site: 'chatgpt' as SiteKey, contents: chatgpt.contents }, { site: 'kimi' as SiteKey, contents: kimi.contents }];
  const controller = new SiteFindController({ targets: () => targets, focused: () => focused,
    allowed: () => allowed, focus: site => { focused = site; controller.sync(); },
    reserve: () => { reserves++; }, restoreFocus: () => { restored++; }, publish: () => {} });
  return { controller, claude, chatgpt, kimi, focus: (site: SiteKey) => { focused = site; controller.sync(); },
    block: () => { allowed = false; controller.sync(); }, remove: () => { targets = targets.slice(0, 2); controller.sync(); },
    reserves: () => reserves, restored: () => restored };
}

test('find requests reject malformed input and native shortcut supports Ctrl/Cmd without IME', () => {
  assert.deepEqual(parseSiteFindRequest({ query: '中文 alpha', scope: 'all' }), { query: '中文 alpha', scope: 'all' });
  for (const request of [null, {}, { query: 1, scope: 'all' }, { query: 'a', scope: 'remote' },
    { query: 'a'.repeat(513), scope: 'all' }]) assert.equal(parseSiteFindRequest(request), null);
  assert.equal(commandAccelerator('find-page' as CommandId, 'win32'), 'CmdOrCtrl+F');
  for (const [platform, modifier] of [['win32', {control:true,meta:false}], ['darwin', {control:false,meta:true}]] as const) {
    assert.equal(commandAliasForInput({ type:'keyDown', key:'f', alt:false, shift:false, ...modifier }, platform), 'find-page');
  }
  assert.equal(commandAliasForInput({ type:'keyDown', key:'f', alt:false, shift:false, control:true, meta:false, isComposing:true }), undefined);
});

test('find uses the platform primary modifier and preserves Mac Control+F text navigation', () => {
  const input = { type:'keyDown', key:'f', alt:false, shift:false, control:false, meta:false };
  assert.equal(commandAliasForInput({ ...input, control:true }, 'darwin'), undefined);
  assert.equal(commandAliasForInput({ ...input, meta:true }, 'linux'), undefined);
  assert.equal(commandAliasForInput({ ...input, meta:true }, 'darwin'), 'find-page');
  assert.equal(commandAliasForInput({ ...input, control:true }, 'win32'), 'find-page');
});

test('search counts every opened page and cycles forwards/backwards across zero-match sites', () => {
  const h = harness();
  try {
    h.controller.open(); h.controller.find({ query:'needle', scope:'all' });
    assert.equal(h.kimi.calls[0].query, 'needle', 'background page must be searched');
    h.claude.contents.result(2); h.chatgpt.contents.result(0); h.kimi.contents.result(1);
    assert.deepEqual(h.controller.state.sites.map(item => item.matches), [2, 0, 1]);
    assert.equal(h.controller.state.activeSite, 'claude');
    h.controller.move(1); h.claude.contents.result(2, 2);
    assert.equal(h.claude.calls.at(-1)?.options.findNext, false);
    h.controller.move(1); h.kimi.contents.result(1);
    assert.equal(h.controller.state.activeSite, 'kimi');
    h.controller.move(1); h.claude.contents.result(2, 1);
    assert.equal(h.controller.state.activeSite, 'claude');
    h.controller.move(-1); h.kimi.contents.result(1);
    assert.equal(h.controller.state.activeSite, 'kimi');
    assert.equal(h.kimi.calls.at(-1)?.options.forward, false);
  } finally { h.controller.dispose(); }
});

test('stale, partial and malformed results cannot replace a newer query or publish false counts', () => {
  const h = harness();
  try {
    h.controller.open(); h.controller.find({ query:'old', scope:'all' });
    const old = h.claude.calls.at(-1)!.id;
    h.controller.find({ query:'new', scope:'all' });
    h.claude.contents.result(99, 1, old);
    h.claude.contents.result(20, 1, undefined, false);
    assert.equal(h.controller.state.sites[0].status, 'pending');
    h.claude.contents.result(Number.NaN);
    assert.equal(h.controller.state.sites[0].status, 'unavailable');
    h.chatgpt.contents.result(1); h.kimi.contents.result(0);
    assert.equal(h.controller.state.query, 'new');
    assert.deepEqual(h.controller.state.sites.map(item => item.matches), [0, 1, 0]);
    h.controller.close(); h.chatgpt.contents.result(100);
    assert.equal(h.controller.state.open, false);
    assert.equal(h.controller.state.sites.length, 0);
  } finally { h.controller.dispose(); }
});

test('current-site scope follows explicit focus and removed pages lose their highlights', () => {
  const h = harness();
  try {
    h.controller.open(); h.controller.find({ query:'needle', scope:'current' }); h.claude.contents.result(2);
    assert.equal(h.chatgpt.calls.length, 0);
    h.focus('kimi'); h.kimi.contents.result(1);
    assert.deepEqual(h.controller.state.sites.map(item => item.site), ['kimi']);
    assert.equal(h.claude.stopped.at(-1), 'clearSelection');
    h.controller.find({ query:'needle', scope:'all' }); h.remove();
    assert.deepEqual(h.controller.state.sites.map(item => item.site), ['claude', 'chatgpt']);
    assert.equal(h.kimi.contents.listenerCount('found-in-page'), 0);
    assert.equal(h.kimi.stopped.at(-1), 'clearSelection');
  } finally { h.controller.dispose(); }
});

test('navigation invalidates old results, reload refreshes counts, and confirmation releases search', () => {
  const h = harness();
  try {
    h.controller.open(); h.controller.find({ query:'needle', scope:'all' }); h.claude.contents.result(2);
    const old = h.claude.calls.at(-1)!.id;
    h.claude.contents.emit('did-start-navigation', { isMainFrame:true, isSameDocument:false });
    h.claude.contents.result(8, 1, old);
    assert.equal(h.controller.state.sites[0].matches, 0);
    h.claude.contents.emit('did-finish-load'); h.claude.contents.result(3);
    assert.equal(h.controller.state.sites[0].matches, 3);
    h.block();
    assert.equal(h.controller.state.open, false); assert.equal(h.restored(), 0);
    assert.equal(h.claude.contents.listenerCount('found-in-page'), 0);
    assert.equal(h.controller.open().open, false);
  } finally { h.controller.dispose(); }
});

test('queued navigation waits for final counts; native crash and timeout settle as unavailable', t => {
  t.mock.timers.enable({ apis:['setTimeout'] });
  const h = harness();
  try {
    h.controller.open(); h.controller.find({ query:'needle', scope:'all' }); h.controller.move(1);
    h.claude.contents.result(0); h.chatgpt.contents.result(1);
    h.kimi.contents.emit('render-process-gone');
    assert.equal(h.controller.state.activeSite, 'chatgpt');
    h.controller.find({ query:'second', scope:'all' }); t.mock.timers.tick(5000);
    assert.equal(h.controller.state.sites.every(item => item.status === 'unavailable'), true);
    h.controller.close(); assert.equal(h.restored(), 1);
  } finally { h.controller.dispose(); }
});

test('rapid next presses retain every action while a native result is pending', () => {
  const h = harness();
  try {
    h.controller.open(); h.controller.find({ query:'needle', scope:'all' });
    h.claude.contents.result(2); h.chatgpt.contents.result(0); h.kimi.contents.result(1);
    h.controller.move(1); h.controller.move(1); h.controller.move(1);
    h.claude.contents.result(2, 2); h.kimi.contents.result(1); h.claude.contents.result(2, 1);
    assert.equal(h.controller.state.activeSite, 'claude', 'three next presses cycle through all three matches');
    assert.equal(h.controller.state.sites[0].active, 1);
  } finally { h.controller.dispose(); }
});

test('blocked and failed main-frame navigation restores a search on the retained document', () => {
  const h = harness();
  try {
    h.controller.open(); h.controller.find({ query:'needle', scope:'all' }); h.claude.contents.result(2);
    const first = h.claude.calls.length;
    h.claude.contents.emit('did-start-navigation', { isMainFrame:true, isSameDocument:false });
    h.claude.contents.emit('will-navigate', { isMainFrame:true, defaultPrevented:true });
    assert.equal(h.claude.calls.length, first + 1, 'a blocked navigation does not get did-finish-load');
    h.claude.contents.result(2);
    assert.equal(h.controller.state.sites[0].status, 'ready');
    h.claude.contents.emit('did-start-navigation', { isMainFrame:true, isSameDocument:false });
    h.claude.contents.emit('did-fail-load', {}, -3, '', '', true);
    assert.equal(h.claude.calls.length, first + 2);
    h.claude.contents.result(2);
    assert.equal(h.controller.state.sites[0].matches, 2);
  } finally { h.controller.dispose(); }
});

test('find bar is a single 48px row', () => assert.equal(SITE_FIND_HEIGHT, 48));

test('find bar reserves its shared height in both densities and composer states', () => {
  for (const density of ['compact','comfortable'] as const) for (const composerExpanded of [false,true]) {
    const input = { width:1500, height:900, density, composerExpanded, drawerOpen:false,
      requestedMode:'overview' as const, focused:'claude' as const, overviewOrder:['claude'] as const, focusOrder:['claude'] as const };
    const before = computeWorkspaceLayout(input), after = computeWorkspaceLayout({ ...input, findOpen:true });
    assert.equal(after.placements[0].bounds.y - before.placements[0].bounds.y, SITE_FIND_HEIGHT);
    assert.equal(before.placements[0].bounds.height - after.placements[0].bounds.height, SITE_FIND_HEIGHT);
  }
});

test('find IPC rejects site frames and malformed actions; disposal removes only owned handlers', () => {
  const h = harness(), contents = new EventEmitter();
  const handlers = new Map<string, (event: unknown, value?: unknown) => unknown>();
  const unrelated = () => {};
  contents.on('before-input-event', unrelated);
  const dispose = registerSiteFindIpc({ handle:(channel, listener) => { handlers.set(channel, listener); },
    removeHandler:channel => { handlers.delete(channel); } }, h.controller, event => event === 'trusted', contents);
  try {
    for (const handler of handlers.values()) assert.throws(() => handler('site-frame'), /untrusted_sender/);
    assert.throws(() => handlers.get('polyask:find-query')!('trusted', { query:'a', scope:'remote' }), /invalid_site_find_request/);
    assert.throws(() => handlers.get('polyask:find-move')!('trusted', 0), /invalid_site_find_direction/);
    assert.throws(() => handlers.get('polyask:find-select')!('trusted', 'unknown'), /invalid_site/);
    handlers.get('polyask:find-open')!('trusted');
    let prevented = false;
    contents.emit('before-input-event', { preventDefault:() => { prevented = true; } }, { type:'keyDown', key:'Escape', isComposing:true });
    assert.equal(prevented, false); assert.equal(h.controller.state.open, true);
    contents.emit('before-input-event', { preventDefault:() => { prevented = true; } }, { type:'keyDown', key:'Escape' });
    assert.equal(h.controller.state.open, false); assert.equal(prevented, true);
  } finally { dispose(); h.controller.dispose(); }
  assert.equal(handlers.size, 0); assert.equal(contents.listenerCount('before-input-event'), 1);
});
