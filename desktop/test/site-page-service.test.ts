import assert from 'node:assert/strict';
import test from 'node:test';
import type { SiteKey } from '../src/shared/contracts';
import { OperationGate } from '../src/shared/operation-gate';
import type { WorkspaceState } from '../src/shared/workspace';
import { SitePageService } from '../src/main/site-page-service';
import { sitePageCloseReason, type SitePageProtection } from '../src/main/view-reclamation';

function fixture() {
  let state: WorkspaceState = { selectedSites: ['claude', 'kimi'], groups: [], tier: null };
  let identity: number | null = 21, writes = 0, releases = 0, publishes = 0;
  let protection: SitePageProtection = { phase: 'ready', capturePending: false, observationEnded: false, navigating: false };
  const gate = new OperationGate();
  const service = new SitePageService({ gate, identity: () => identity, closeReason: () => sitePageCloseReason(protection),
    workspace: { getState: () => state, setSelection: sites => { writes++; state = { ...state, selectedSites: [...sites] }; return state; } },
    publish: () => { publishes++; return state; },
    release: () => { releases++; identity = null; } });
  return { service, gate, state: () => state, counts: () => [writes, publishes, releases],
    identity: (next: number | null) => { identity = next; }, protect: (next: Partial<SitePageProtection>) => { protection = { ...protection, ...next }; } };
}
const request = { site: 'kimi' as const, contentsId: 21, confirmed: true as const };

test('preview is read-only and an explicitly confirmed idle close releases in a covered surface', async () => {
  const h = fixture();
  assert.deepEqual(h.service.preview('kimi'), { site: 'kimi', contentsId: 21, reason: null });
  assert.deepEqual(h.counts(), [0, 0, 0]);
  const result = await h.service.close(request);
  assert.equal(result.state, 'closed');
  assert.deepEqual(h.state().selectedSites, ['claude']);
  assert.deepEqual(h.counts(), [1, 1, 1], 'confirmation requires an explicit release after publish');
  assert.deepEqual(h.service.preview('kimi'), { site: 'kimi', contentsId: null, reason: null });
  assert.equal((await h.service.close(request)).state, 'not_open');
  assert.deepEqual(h.counts(), [1, 1, 1]);
});

test('identity and each protection fact are rechecked after the user saw a close preview', async () => {
  for (const [protection, expected] of [
    [{ phase: 'sending' }, 'sending'], [{ phase: 'generating' }, 'generation_pending'],
    [{ phase: 'warning' }, 'generation_pending'], [{ capturePending: true }, 'capture_pending'],
    [{ navigating: true }, 'navigating']
  ] as const) {
    const h = fixture(); h.service.preview('kimi'); h.protect(protection);
    assert.deepEqual(await h.service.close(request), { state: 'blocked', reason: expected });
    assert.deepEqual(h.state().selectedSites, ['claude', 'kimi']);
    assert.deepEqual(h.counts(), [0, 0, 0]);
  }
  const h = fixture(); h.service.preview('kimi'); h.identity(22);
  assert.deepEqual(await h.service.close(request), { state: 'blocked', reason: 'page_changed' });
  assert.deepEqual(h.counts(), [0, 0, 0]);
});

test('the same operation gate rejects closing while dispatch or navigation has not settled', async () => {
  const h = fixture(); let finish!: () => void;
  const operation = h.gate.run(() => new Promise<void>(resolve => { finish = resolve; }));
  assert.deepEqual(await h.service.close(request), { state: 'blocked', reason: 'operation_busy' });
  assert.deepEqual(h.counts(), [0, 0, 0]);
  finish(); await operation;
  assert.equal((await h.service.close(request)).state, 'closed');
});

test('only a registered site, confirmed true and a positive safe contents identity can close', async () => {
  const h = fixture();
  for (const value of [null, {}, { ...request, confirmed: false }, { ...request, site: 'unknown' },
    { ...request, contentsId: 0 }, { ...request, contentsId: Infinity }, { ...request, contentsId: 1.5 }]) {
    await assert.rejects(h.service.close(value), /invalid_site_page_close/);
  }
  assert.throws(() => h.service.preview('unknown'), /invalid_site/);
  assert.deepEqual(h.counts(), [0, 0, 0]);
});

test('persistent write failure cannot release the original view or publish a false close', async () => {
  const state: WorkspaceState = { selectedSites: ['kimi'], groups: [], tier: null };
  let releases = 0, publishes = 0;
  const service = new SitePageService({ gate: new OperationGate(), identity: () => 21, closeReason: () => null,
    workspace: { getState: () => state, setSelection: () => { throw new Error('storage_failed'); } },
    publish: () => { publishes++; return state; }, release: () => { releases++; } });
  await assert.rejects(service.close(request), /storage_failed/);
  assert.equal(releases + publishes, 0);
  assert.deepEqual(state.selectedSites, ['kimi']);
});

test('close checks the identity inside gate entry and does not use the preview snapshot', async () => {
  let id = 21, writes = 0, enter!: () => void;
  const state: WorkspaceState = { selectedSites: ['kimi'], groups: [], tier: null };
  const service = new SitePageService({ identity: () => id, closeReason: () => null, release: () => { writes++; },
    workspace: { getState: () => state, setSelection: (_sites: readonly SiteKey[]) => { writes++; return state; } },
    publish: () => state,
    gate: { run: async action => { await new Promise<void>(resolve => { enter = resolve; }); return action(); } } });
  service.preview('kimi'); const pending = service.close(request); id = 25; enter();
  assert.deepEqual(await pending, { state: 'blocked', reason: 'page_changed' });
  assert.equal(writes, 0);
});
