import assert from 'node:assert/strict';
import test from 'node:test';
import { act, useEffect, useRef } from 'react';
import { useSiteParticipation } from '../src/renderer/use-site-participation';
import { useWorkspaceFlow } from '../src/renderer/use-workspace-flow';
import { useSyncedSiteParticipation } from '../src/renderer/use-synced-site-participation';
import { ExclusiveActionLock } from '../src/renderer/broadcast-flow-state';
import { setShellApi } from '../src/renderer/shell-api';
import { SITES } from '../src/main/sites';
import type { WorkspaceState } from '../src/shared/workspace';
import { mountDom } from './ui/dom-harness';

for (const stage of ['open', 'save'] as const) test(`cancelled caller receives no late participation ${stage} failure notification`, async () => {
  let controller!: ReturnType<typeof useSiteParticipation>, reject!: (error: Error) => void;
  let current = true, errors = 0, saves = 0;
  const pending = () => new Promise<readonly ('claude' | 'kimi')[]>((_resolve, fail) => { reject = fail; });
  function Fixture() {
    controller = useSiteParticipation({ ready: true, opened: stage === 'open' ? ['claude'] : ['claude', 'kimi'], saved: ['claude'],
      onError: () => { errors++; }, openPages: pending, save: () => { saves++; return pending(); } });
    return <span>{controller.pending ? 'pending' : 'ready'}</span>;
  }
  const h = await mountDom(<Fixture />);
  try {
    let operation!: Promise<boolean>;
    await act(async () => { operation = controller.change(['kimi'], () => current); });
    current = false;
    await act(async () => { reject(new Error('late failure')); assert.equal(await operation, false); });
    assert.equal(errors, 0, 'a cancelled task must not publish a failure into a later screen');
    assert.equal(controller.pending, false);
    assert.equal(saves, stage === 'save' ? 1 : 0);
  } finally { await h.close(); }
});

for (const stage of ['open', 'save'] as const) test(`production workspace recovers silently after cancelled ${stage} fails`, async () => {
  let controller!: ReturnType<typeof useSiteParticipation>, reject!: (error: Error) => void;
  let current = true, errors = 0, recovered!: (state: { workspace: WorkspaceState }) => void;
  const initial: WorkspaceState = { selectedSites: stage === 'open' ? ['claude'] : ['claude', 'kimi'],
    participatingSites: ['claude'], tier: null, groups: [] };
  const pending = () => new Promise<WorkspaceState>((_resolve, fail) => { reject = fail; });
  setShellApi({ setSelection: pending, setParticipation: pending,
    bootstrap: () => new Promise<{ workspace: WorkspaceState }>(resolve => { recovered = resolve; }) } as any);
  function Fixture() {
    const flow = useWorkspaceFlow(SITES, 'failed', () => { errors++; });
    const lock = useRef(new ExclusiveActionLock()).current;
    controller = useSyncedSiteParticipation(flow, true, lock, () => { errors++; });
    useEffect(() => flow.accept(initial), []);
    return <span>{controller.pending ? 'pending' : 'ready'}</span>;
  }
  const h = await mountDom(<Fixture />);
  try {
    let operation!: Promise<boolean>;
    await act(async () => { operation = controller.change(['kimi'], () => current); });
    current = false;
    await act(async () => { reject(new Error('late IPC failure')); assert.equal(await operation, false); });
    assert.equal(errors, 0, 'workspace recovery and participation feedback both respect cancelled ownership');
    assert.equal(controller.pending, false);
    assert.deepEqual(controller.currentSites(), ['claude']);
    const authoritative: WorkspaceState = { ...initial, selectedSites: ['kimi', 'gemini'], participatingSites: ['gemini'],
      participationVersion: { updatedAt: 200, deviceId: 'remote' } };
    await act(async () => recovered({ workspace: authoritative }));
    assert.deepEqual(controller.currentSites(), ['gemini'], 'cancelled recovery still adopts the newer authoritative workspace');
    assert.equal(errors, 0);
  } finally { await h.close(); setShellApi(null); }
});
