import assert from 'node:assert/strict';
import test from 'node:test';
import { act, StrictMode } from 'react';
import { useSynthesisFlow } from '../src/renderer/use-synthesis-flow';
import { ExclusiveActionLock } from '../src/renderer/broadcast-flow-state';
import { setShellApi } from '../src/renderer/shell-api';
import { mountDom } from './ui/dom-harness';
import { archiveFixture } from './fixtures';
import type { PendingSynthesis, SynthesisSendRequest } from '../src/shared/synthesis';
import type { ArchiveRecord } from '../src/shared/archive';

const pending = (id: string): PendingSynthesis => ({ archiveId: id, targetSite: 'claude', targetHost: 'claude.ai',
  tier: null, instruction: 'Request for ' + id, sentAt: id === 'A' ? 1 : 2 });
async function setup() {
  const lock = new ExclusiveActionLock(); let flow!: ReturnType<typeof useSynthesisFlow>;
  function Probe() { flow = useSynthesisFlow(lock); return <span>{flow.pending?.archiveId}</span>; }
  const h = await mountDom(<StrictMode><Probe /></StrictMode>);
  return { ...h, current: () => flow, async close() { await h.close(); setShellApi(null); } };
}

test('a late authorized save cannot clear a newer pending analysis or return an old navigation target', async () => {
  let finish!: (record: ArchiveRecord) => void;
  setShellApi({ saveSynthesis: () => new Promise(resolve => { finish = resolve; }) } as any);
  const h = await setup(); try {
    await act(async () => h.current().acceptPending(pending('A')));
    const saving = h.current().save(false); const rejected = assert.rejects(saving, /synthesis_not_pending/);
    await act(async () => h.current().acceptPending(pending('B')));
    await act(async () => finish({ ...archiveFixture(), id: 'A' })); await rejected;
    assert.equal(h.current().pending?.archiveId, 'B');
  } finally { await h.close(); }
});

test('known send purpose stays in session and recovered pending state does not guess its purpose', async () => {
  setShellApi({ sendSynthesis: async () => ({ result: { site: 'claude', ok: true }, pending: pending('A') }) } as any);
  const h = await setup(); try {
    const request: SynthesisSendRequest = { archiveId: 'A', targetSite: 'claude', tier: null,
      selectedHosts: ['claude.ai'], instruction: 'Why?', excerpt: 'Exact source' };
    await act(async () => { await h.current().send(request, () => {}); });
    assert.equal((h.current() as any).session?.purpose, 'followUp');
    assert.equal((h.current() as any).session?.archiveId, 'A');
    await act(async () => h.current().acceptPending(pending('B')));
    assert.equal((h.current() as any).session, null, 'bootstrap has no persisted purpose field');
  } finally { await h.close(); }
});

test('resetting pending state invalidates the late save and clears session context', async () => {
  let finish!: (record: ArchiveRecord) => void;
  setShellApi({ saveSynthesis: () => new Promise(resolve => { finish = resolve; }) } as any);
  const h = await setup(); try {
    await act(async () => h.current().acceptPending(pending('A')));
    const saving = h.current().save(false), rejected = assert.rejects(saving, /synthesis_not_pending/);
    await act(async () => h.current().acceptPending(null));
    await act(async () => finish({ ...archiveFixture(), id: 'A' })); await rejected;
    assert.equal(h.current().pending, null); assert.equal((h.current() as any).session, null);
  } finally { await h.close(); }
});
