import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { SiteFindController } from '../src/main/site-find';
import { registerSiteFindIpc } from '../src/main/site-find-ipc';

const pause = (ms = 180) => new Promise(resolve => setTimeout(resolve, ms));
function harness() {
  let request = 0, focused = 0;
  const pending: { code: string; resolve(value: unknown): void; reject(error: Error): void }[] = [];
  const contents = Object.assign(new EventEmitter(), { id: 17, isDestroyed: () => false,
    findInPage: () => ++request, stopFindInPage() {},
    executeJavaScriptInIsolatedWorld: (_world: number, scripts: { code: string }[]) =>
      new Promise((resolve, reject) => pending.push({ code: scripts[0].code, resolve, reject })) });
  const controller = new SiteFindController({ targets: () => [{ site: 'claude', contents }], focused: () => 'claude', allowed: () => true,
    focus() { focused++; }, reserve() {}, restoreFocus() {}, publish() {} });
  const result = () => contents.emit('found-in-page', {}, { requestId: request, matches: 2, activeMatchOrdinal: 1, finalUpdate: true });
  controller.open(); controller.find({ query: 'needle', scope: 'all' }); result();
  const positions = () => (controller.state.sites[0] as { positions?: readonly number[] })?.positions;
  return { controller, contents, pending, positions, result, requests: () => request, focused: () => focused };
}

test('native find results gain optional positions without changing counts or active selection', async () => {
  const h = harness();
  try {
    await pause();
    assert.equal(h.pending.length, 1, 'finished native search requests a read-only location summary');
    h.pending[0].resolve([0.1, 0.8]); await pause(0);
    assert.deepEqual(h.positions(), [0.1, 0.8]);
    assert.equal(h.controller.state.sites[0].matches, 2);
    assert.equal(h.controller.state.sites[0].active, 1);
  } finally { h.controller.dispose(); }
});

test('late locations cannot survive a new query, close and reopen, or navigation', async () => {
  for (const change of ['query', 'reopen', 'navigate']) {
    const h = harness();
    try {
      await pause(); assert.equal(h.pending.length, 1);
      if (change === 'query') h.controller.find({ query: 'new', scope: 'all' });
      if (change === 'reopen') { h.controller.close(); h.controller.open(); }
      if (change === 'navigate') h.contents.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false });
      h.pending[0].resolve([0.2, 0.9]); await pause(0);
      assert.equal(h.positions(), undefined);
    } finally { h.controller.dispose(); }
  }
});

test('malformed positions and failed or unsupported probes leave native search usable', async () => {
  for (const value of [[-1], [NaN], [0.2, 'bad'], Array(1001).fill(0.1), null, new Error('gone')]) {
    const h = harness();
    try {
      await pause(); assert.equal(h.pending.length, 1);
      if (value instanceof Error) h.pending[0].reject(value); else h.pending[0].resolve(value);
      await pause(0);
      assert.equal(h.positions(), undefined);
      assert.equal(h.controller.state.sites[0].status, 'ready');
      assert.equal(h.controller.state.sites[0].matches, 2);
    } finally { h.controller.dispose(); }
  }
});

test('changing query never queues overlapping probes in the same WebContents', async () => {
  const h = harness();
  try {
    await pause(); assert.equal(h.pending.length, 1);
    h.controller.find({ query: 'new', scope: 'all' }); h.result();
    await pause(); assert.equal(h.pending.length, 1, 'previous isolated read must finish first');
    h.pending[0].resolve([0.1]); await pause();
    assert.equal(h.pending.length, 2);
    h.pending[1].resolve([0.2, 0.9]); await pause(0);
    assert.deepEqual(h.positions(), [0.2, 0.9]);
  } finally { h.controller.dispose(); }
});

test('same-document navigation clears previous positions before recounting', async () => {
  const h = harness();
  try {
    await pause(); h.pending[0].resolve([0.1, 0.8]); await pause(0);
    h.contents.emit('did-navigate-in-page', {}, 'https://example.test/new', true);
    assert.equal(h.positions(), undefined);
    assert.equal(h.controller.state.sites[0].status, 'pending');
  } finally { h.controller.dispose(); }
});

test('timed out location reads keep native matches available and ignore late results', async () => {
  const h = harness();
  try {
    await pause(); await pause(1250);
    assert.equal(h.controller.state.sites[0].status, 'ready');
    assert.equal(h.controller.state.sites[0].matches, 2);
    h.pending[0].resolve([0.1, 0.8]); await pause(0);
    assert.equal(h.positions(), undefined);
  } finally { h.controller.dispose(); }
});

test('a later layout refresh still clears stale positions when an earlier read hangs', async () => {
  const h = harness();
  try {
    await pause(); h.pending[0].resolve([0.1, 0.8]); await pause(0);
    h.controller.sync(); await pause();
    assert.equal(h.pending.length, 2);
    h.controller.sync(); await pause(1250);
    assert.equal(h.positions(), undefined, 'latest refresh owns its own timeout while the previous read is pending');
    assert.equal(h.controller.state.sites[0].matches, 2);
    h.pending[1].resolve([0.2, 0.9]); await pause(150);
    assert.equal(h.positions(), undefined);
  } finally { h.controller.dispose(); }
});

test('position-only replies never cancel valid native menu selection or refresh', async () => {
  for (const kind of ['select', 'refresh'] as const) {
    const h = harness(), handlers = new Map<string, (event: unknown, value: unknown) => any>();
    let finish!: (value: any) => void;
    const dispose = registerSiteFindIpc({ handle: (channel, action) => handlers.set(channel, action), removeHandler: channel => { handlers.delete(channel); } },
      h.controller, sender => sender === 'shell', new EventEmitter(), () => new Promise(resolve => { finish = resolve; }));
    try {
      const { session, revision } = h.controller.state, requests = h.requests();
      const action = handlers.get('polyask:find-menu')!('shell', { session, revision });
      await pause(); h.pending[0].resolve([0.1, 0.8]); await pause(0);
      assert.deepEqual(h.positions(), [0.1, 0.8]);
      finish(kind === 'select' ? { kind, site: 'claude' } : { kind }); await action;
      assert.equal(kind === 'select' ? h.focused() : h.requests() - requests, 1, kind + ' still executes exactly once');
    } finally { dispose(); h.controller.dispose(); }
  }
});

test('repeating the same native search still invalidates an older menu', async () => {
  const h = harness(), handlers = new Map<string, (event: unknown, value: unknown) => any>();
  let finish!: (value: any) => void;
  const dispose = registerSiteFindIpc({ handle: (channel, action) => handlers.set(channel, action), removeHandler: channel => { handlers.delete(channel); } },
    h.controller, () => true, new EventEmitter(), () => new Promise(resolve => { finish = resolve; }));
  try {
    const { session, revision } = h.controller.state;
    const action = handlers.get('polyask:find-menu')!('shell', { session, revision });
    h.controller.find({ query: 'needle', scope: 'all' }); h.result();
    finish({ kind: 'select', site: 'claude' }); await action;
    assert.equal(h.focused(), 0, 'same query and counts do not make an old menu current again');
  } finally { dispose(); h.controller.dispose(); }
});
