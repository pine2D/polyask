import assert from 'node:assert/strict';
import test from 'node:test';
import { act } from 'react';
import { SITES } from '../src/main/sites';
import type { SiteKey } from '../src/shared/contracts';
import type { WorkspaceState } from '../src/shared/workspace';
import { setShellApi } from '../src/renderer/shell-api';
import { useWorkspaceFlow } from '../src/renderer/use-workspace-flow';
import { mountDom } from './ui/dom-harness';

async function fixture() {
  let flow!: ReturnType<typeof useWorkspaceFlow>;
  const calls: Array<{ keys: readonly SiteKey[]; finish(state: WorkspaceState): void }> = [];
  const saved: Array<{ name: string; sites: readonly SiteKey[] }> = [];
  const state: WorkspaceState = { selectedSites: ['claude', 'kimi'], groups: [], tier: null };
  setShellApi({ setSelection: (keys: readonly SiteKey[]) => new Promise<WorkspaceState>(resolve => calls.push({ keys, finish: resolve })),
    saveGroup: async (input: { name: string; sites: readonly SiteKey[] }) => { saved.push(input); return state; } } as any);
  function Fixture() { flow = useWorkspaceFlow(SITES, 'failed', () => undefined); return <span>{flow.workspace.selectedSites.join(',')}</span>; }
  const h = await mountDom(<Fixture />);
  await act(async () => flow.accept(state));
  return { ...h, state, calls, saved, flow: () => flow,
    close: async () => { await h.close(); setShellApi(null); } };
}

test('awaitable openPages shares the optimistic request guard and accepts its own publication before ACK', async () => {
  const h = await fixture();
  try {
    let operation!: Promise<readonly SiteKey[]>;
    await act(async () => { operation = h.flow().openPages(['claude', 'kimi', 'gemini']); });
    await act(async () => h.flow().accept({ ...h.state, selectedSites: ['claude', 'kimi', 'gemini'] }));
    await act(async () => h.flow().accept(h.state));
    assert.deepEqual(h.flow().currentSelection(), ['claude', 'kimi', 'gemini']);
    await act(async () => { h.calls[0].finish({ ...h.state, selectedSites: ['claude', 'kimi', 'gemini'] });
      assert.deepEqual(await operation, ['claude', 'kimi', 'gemini']); });
  } finally { await h.close(); }
});

test('reset invalidates pending open ACKs without changing currentSelection into broadcast participation', async () => {
  const h = await fixture();
  try {
    let operation!: Promise<readonly SiteKey[]>;
    await act(async () => { operation = h.flow().openPages(['claude', 'kimi', 'gemini']); });
    const invalidate = (h.flow() as unknown as { invalidate?: () => void }).invalidate;
    assert.equal(typeof invalidate, 'function', 'local reset needs an explicit pending-open invalidation boundary');
    await act(async () => { invalidate!(); h.flow().accept({ ...h.state, selectedSites: ['deepseek'] }); });
    await act(async () => { h.calls[0].finish({ ...h.state, selectedSites: ['claude', 'kimi', 'gemini'] }); await operation; });
    assert.deepEqual(h.flow().currentSelection(), ['deepseek']);
    assert.deepEqual(h.flow().workspace.selectedSites, ['deepseek']);
  } finally { await h.close(); }
});

test('saving a send group uses explicit participants and keeps persisted open-page membership', async () => {
  const h = await fixture();
  try {
    await act(async () => { assert.equal(await h.flow().saveGroup('Only Claude', ['claude']), true); });
    assert.deepEqual(h.saved, [{ name: 'Only Claude', sites: ['claude'] }]);
    assert.deepEqual(h.flow().currentSelection(), ['claude', 'kimi']);
  } finally { await h.close(); }
});
