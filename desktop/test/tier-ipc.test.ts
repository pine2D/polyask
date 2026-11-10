import assert from 'node:assert/strict';
import test from 'node:test';
import { DesktopDatabase } from '../src/main/database';
import { WorkspaceService } from '../src/main/workspace-service';
import { OperationGate } from '../src/shared/operation-gate';
import { registerTierIpc } from '../src/main/tier-ipc';
import type { SiteKey } from '../src/shared/contracts';

test('immediate tier IPC gates mutations, freezes participating scope, and isolates failures', async () => {
  const database = DesktopDatabase.open(':memory:');
  const workspace = new WorkspaceService(database.state, database.meta, () => {}, { createDeviceId: () => 'local' });
  workspace.setSelection(['claude', 'kimi', 'gemini']); workspace.setParticipation(['claude', 'kimi']);
  const gate = new OperationGate(), handlers = new Map<string, Function>();
  const calls: { site: SiteKey; tier: string; deadline: number }[] = [];
  let release!: () => void, resetting = false, publications = 0;
  const waiting = new Promise<void>(resolve => { release = resolve; });
  const dispose = registerTierIpc({ ipc: { handle: (name, fn) => { handlers.set(name, fn); }, removeHandler: name => { handlers.delete(name); } },
    workspace, gate, trusted: event => event === 'shell' as any, blocked: () => resetting,
    publish: () => { publications++; return workspace.getState(); },
    switchTier: async (site, tier, deadline) => { calls.push({ site, tier, deadline }); await waiting;
      if (site === 'kimi') throw Error('site failed');
      return { ok: true, selection: { requested: tier, outcome: 'mode_only', observed: tier } }; }
  });
  try {
    const apply = handlers.get('polyask:apply-tier')!;
    await assert.rejects(async () => apply('site', 'think'), /untrusted_sender/);
    await assert.rejects(async () => apply('shell', 'invalid'), /invalid_tier/);
    assert.equal(publications, 0);
    const pending = apply('shell', 'think');
    assert.equal(gate.busy, true);
    assert.equal(workspace.getState().tier, 'think');
    assert.deepEqual(calls.map(item => item.site), ['claude', 'kimi']);
    assert.equal(new Set(calls.map(item => item.deadline)).size, 1);
    assert.ok(calls[0].deadline <= Date.now() + 10_000);
    await assert.rejects(async () => apply('shell', 'fast'), /operation_busy/);
    assert.equal(workspace.getState().tier, 'think');
    workspace.setParticipation(['gemini']); release();
    const result = await pending;
    assert.deepEqual(result.results.map((item: any) => [item.site, item.ok]), [['claude', true], ['kimi', false]]);
    assert.equal(result.results[1].code, 'error');
    assert.deepEqual(result.workspace.participatingSites, ['gemini']);
    assert.equal(gate.busy, false);
    assert.equal((await apply('shell', null)).results.length, 0);
    assert.equal(calls.length, 2);
    resetting = true;
    await assert.rejects(async () => apply('shell', 'fast'), /operation_busy/);
    assert.equal(workspace.getState().tier, null);
    resetting = false; workspace.setParticipation([]);
    assert.equal((await apply('shell', 'fast')).results.length, 0);
    assert.equal(workspace.getState().tier, 'fast');
  } finally { release(); dispose(); database.close(); }
  assert.equal(handlers.size, 0);
});

test('immediate tier uses per-site presets captured before dispatch and never affects another site', async () => {
  const { DEFAULT_PREFERENCE_VALUES } = await import('../src/shared/preferences');
  const database = DesktopDatabase.open(':memory:');
  const workspace = new WorkspaceService(database.state, database.meta, () => {}, { createDeviceId: () => 'local' });
  workspace.setSelection(['claude', 'kimi']); workspace.setParticipation(['claude', 'kimi']);
  const values = { ...DEFAULT_PREFERENCE_VALUES, claudeFastPreset: { model: 'Opus 5.5', effort: 'Max' } };
  const calls: unknown[] = [], handlers = new Map<string, Function>();
  const dispose = registerTierIpc({ ipc: { handle: (key, fn) => { handlers.set(key, fn); }, removeHandler: key => { handlers.delete(key); } },
    workspace, gate: new OperationGate(), trusted: () => true, blocked: () => false, publish: () => workspace.getState(),
    preferences: () => values, switchTier: async (site, _tier, _deadline, preset) => {
      calls.push([site, preset]); values.claudeFastPreset.effort = 'Low'; return { ok: true };
    } });
  try {
    await handlers.get('polyask:apply-tier')!({}, 'fast');
    assert.deepEqual(calls, [['claude', { model: 'Opus 5.5', effort: 'Max' }], ['kimi', undefined]]);
  } finally { dispose(); database.close(); }
});
