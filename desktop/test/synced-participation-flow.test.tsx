import assert from 'node:assert/strict';
import test from 'node:test';
import { act } from 'react';
import { DesktopDatabase } from '../src/main/database';
import { SITES } from '../src/main/sites';
import { WorkspaceService } from '../src/main/workspace-service';
import type { WorkspaceState } from '../src/shared/workspace';
import type { SiteKey } from '../src/shared/contracts';
import { setShellApi } from '../src/renderer/shell-api';
import { useWorkspaceFlow } from '../src/renderer/use-workspace-flow';
import { useSyncedSiteParticipation } from '../src/renderer/use-synced-site-participation';
import { ExclusiveActionLock } from '../src/renderer/broadcast-flow-state';
import { mountDom } from './ui/dom-harness';

async function fixture() {
  const database = DesktopDatabase.open(':memory:');
  const main = new WorkspaceService(database.state, database.meta, () => {}, { createDeviceId: () => 'local' });
  main.setSelection(['claude', 'kimi']); main.setParticipation(['kimi']);
  let flow!: ReturnType<typeof useWorkspaceFlow>, participation!: ReturnType<typeof useSyncedSiteParticipation>;
  const lock = new ExclusiveActionLock();
  const saves: { state: WorkspaceState; finish(): void; fail(): void }[] = [];
  const opened: (readonly SiteKey[])[] = [];
  setShellApi({
    setSelection: async (sites: readonly SiteKey[]) => { opened.push(sites); return main.setSelection(sites); },
    setParticipation: (sites: readonly SiteKey[]) => new Promise<WorkspaceState>((resolve, reject) => {
      const state = main.setParticipation(sites);
      saves.push({ state, finish: () => resolve(state), fail: () => reject(Error('save_failed')) });
    }),
    bootstrap: async () => { throw Error('bootstrap_failed'); }
  } as any);
  function Fixture() {
    flow = useWorkspaceFlow(SITES, 'failed', () => {});
    participation = useSyncedSiteParticipation(flow, true, lock, () => {});
    return <span>{participation.participating.join(',')}</span>;
  }
  const h = await mountDom(<Fixture />);
  await act(async () => flow.accept(main.getState()));
  return { ...h, main, opened, saves, lock, flow: () => flow, participation: () => participation,
    close: async () => { await h.close(); setShellApi(null); database.close(); } };
}

test('production workspace and participation hooks save a newly opened site after its open ACK', async () => {
  const h = await fixture();
  try {
    assert.deepEqual(h.participation().currentSites(), ['kimi']);
    let operation!: Promise<boolean>;
    await act(async () => { operation = h.participation().change(['gemini']); });
    assert.deepEqual(h.opened, [['claude', 'kimi', 'gemini']]);
    assert.equal(h.saves.length, 1);
    assert.equal(h.lock.busy, true);
    await act(async () => h.flow().accept(h.saves[0].state));
    assert.deepEqual(h.participation().currentSites(), []);
    await act(async () => { h.saves[0].finish(); assert.equal(await operation, true); });
    assert.deepEqual(h.participation().currentSites(), ['gemini']);
    assert.equal(h.lock.busy, false);
    assert.deepEqual(h.main.getState().participatingSites, ['gemini']);
  } finally { await h.close(); }
});

test('reset invalidates a late save ACK and leaves the new bootstrap membership in place', async () => {
  const h = await fixture();
  try {
    let operation!: Promise<boolean>;
    await act(async () => { operation = h.participation().change(['claude']); });
    await act(async () => {
      h.flow().invalidate(); h.participation().reset();
      h.flow().accept({ selectedSites: ['kimi'], participatingSites: [], tier: null, groups: [] });
    });
    await act(async () => { h.saves[0].finish(); assert.equal(await operation, false); });
    assert.deepEqual(h.participation().currentSites(), []);
    assert.deepEqual(h.flow().workspace.selectedSites, ['kimi']);
    assert.equal(h.lock.busy, false);
  } finally { await h.close(); }
});

test('a newer remote participation push wins over an older local save ACK', async () => {
  const h = await fixture();
  try {
    let operation!: Promise<boolean>;
    await act(async () => { operation = h.participation().change(['claude']); });
    const newer = { ...h.saves[0].state, participatingSites: [] as SiteKey[],
      participationVersion: { updatedAt: Date.now() + 1000, deviceId: 'remote' } };
    await act(async () => h.flow().accept(newer));
    await act(async () => { h.saves[0].finish(); await operation; });
    assert.deepEqual(h.participation().currentSites(), []);
    assert.deepEqual(h.flow().workspace.participatingSites, []);
  } finally { await h.close(); }
});

test('a failed save restores the latest accepted push even when recovery bootstrap fails', async () => {
  const h = await fixture();
  try {
    let operation!: Promise<boolean>;
    await act(async () => { operation = h.participation().change(['claude']); });
    const newer = { ...h.saves[0].state, participatingSites: [] as SiteKey[],
      participationVersion: { updatedAt: Date.now() + 1000, deviceId: 'remote' } };
    await act(async () => h.flow().accept(newer));
    await act(async () => { h.saves[0].fail(); assert.equal(await operation, false); });
    assert.deepEqual(h.participation().currentSites(), []);
    assert.deepEqual(h.flow().workspace.participatingSites, []);
    assert.equal(h.lock.busy, false);
  } finally { await h.close(); }
});
