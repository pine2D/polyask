import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { createIdleThrottlingExperiment } from '../src/main/idle-throttling-policy';
function harness(enabled = true) {
  let minimized = false, tick = () => {}, probes = 0, delayed: (() => void) | undefined;
  const events = new EventEmitter();
  const sites = [1, 2].map(id => ({ id, phase: 'ready', loading: false, attached: true, allowed: false,
    state: 'idle' as string | null, changes: [] as boolean[], set(allowed: boolean) { this.allowed = allowed; this.changes.push(allowed); } }));
  const policy = createIdleThrottlingExperiment({ enabled,
    minimized: () => minimized, sites: () => sites.map(s => ({ ...s, set: (v: boolean) => s.set(v) })),
    probe: async id => { probes++; const target = sites.find(s => s.id === id)!; if (delayed) await new Promise<void>(resolve => { delayed = resolve; }); return target.state; },
    listen: (event, callback) => { events.on(event, callback); return () => { events.off(event, callback); }; },
    interval: callback => { tick = callback; return () => { tick = () => {}; }; }
  });
  return { sites, policy, probes: () => probes, events, tick: async () => { tick(); await new Promise(r => setImmediate(r)); },
    minimize: () => { minimized = true; events.emit('minimize'); }, restore: () => { minimized = false; events.emit('restore'); },
    delay: () => { delayed = () => {}; }, release: () => { const done = delayed; delayed = undefined; done?.(); } };
}
test('default off allocates no listeners, probes or mutations', async () => {
  const h = harness(false); h.minimize(); await h.tick();
  assert.equal(h.events.eventNames().length, 0); assert.equal(h.probes(), 0);
  assert.ok(h.sites.every(s => s.changes.length === 0)); h.policy.dispose();
});
test('all sites must be idle; restore disables throttling synchronously', async () => {
  const h = harness(); await h.tick(); assert.equal(h.probes(), 0);
  h.minimize(); await h.tick(); assert.ok(h.sites.every(s => s.allowed));
  h.restore(); assert.ok(h.sites.every(s => !s.allowed)); h.policy.dispose();
});
for (const phase of ['sending', 'submitted', 'generating', 'warning', 'failed', 'cancelled', 'crashed', 'unknown']) {
  test(`unsafe phase ${phase} keeps every site unthrottled`, async () => {
    const h = harness(); h.sites[1].phase = phase; h.minimize(); await h.tick();
    assert.ok(h.sites.every(s => !s.allowed)); assert.equal(h.probes(), 0); h.policy.dispose();
  });
}
test('null, generating, loading and detached sites cannot authorize throttling', async () => {
  for (const change of [{ state: null }, { state: 'generating' }, { loading: true }, { attached: false }]) {
    const h = harness(); Object.assign(h.sites[1], change); h.minimize(); await h.tick();
    assert.ok(h.sites.every(s => !s.allowed)); h.policy.dispose();
  }
});
test('command wake disables all sites before dispatch and latches until restore', async () => {
  const h = harness(); h.minimize(); await h.tick(); h.policy.wake();
  assert.ok(h.sites.every(s => !s.allowed)); await h.tick(); assert.ok(h.sites.every(s => !s.allowed));
  h.restore(); h.minimize(); await h.tick(); assert.ok(h.sites.every(s => s.allowed)); h.policy.dispose();
});
test('restore or command invalidates an in-flight idle probe', async () => {
  for (const action of ['restore', 'wake'] as const) {
    const h = harness(); h.sites.splice(1); h.delay(); h.minimize(); await h.tick();
    if (action === 'restore') h.restore(); else h.policy.wake();
    h.release(); await h.tick(); assert.equal(h.sites[0].allowed, false); h.policy.dispose();
  }
});
test('membership changes during a probe cannot authorize a stale snapshot', async () => {
  const h = harness(); h.sites.splice(1); h.delay(); h.minimize(); await h.tick();
  h.sites[0].id = 3; h.release(); await h.tick(); assert.equal(h.sites[0].allowed, false); h.policy.dispose();
});
test('probe failures and setter failures disable the experiment and restore peers', async () => {
  const h = harness(); h.sites[1].set = () => { throw Error('destroyed'); };
  h.minimize(); await h.tick(); assert.equal(h.sites[0].allowed, false); h.policy.dispose();
});
test('dispose restores settings and removes all listeners', async () => {
  const h = harness(); h.minimize(); await h.tick(); h.policy.dispose();
  assert.ok(h.sites.every(s => !s.allowed)); assert.equal(h.events.eventNames().length, 0);
});

test('activity while visible does not prevent the next idle minimize', async () => {
  const h = harness(); h.policy.wake(); h.minimize(); await h.tick();
  assert.ok(h.sites.every(s => s.allowed)); h.policy.dispose();
});
test('a phase change while waiting rejects an otherwise idle probe', async () => {
  const h = harness(); h.sites.splice(1); h.delay(); h.minimize(); await h.tick();
  h.sites[0].phase = 'submitted'; h.release(); await h.tick();
  assert.equal(h.sites[0].allowed, false); h.policy.dispose();
});
test('a latched short reply (complete_observed) counts as idle like complete', async () => {
  const h = harness(); h.sites[0].state = 'complete_observed'; h.sites[1].state = 'complete';
  h.minimize(); await h.tick(); assert.ok(h.sites.every(s => s.allowed)); h.policy.dispose();
});
