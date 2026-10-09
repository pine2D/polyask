import assert from 'node:assert/strict';
import test from 'node:test';
import { act } from 'react';
import { DesktopDatabase } from '../src/main/database';
import { DraftRepository } from '../src/main/draft-repository';
import { usePromptDraft } from '../src/renderer/use-prompt-draft';
import { useComparisonWorksheet } from '../src/renderer/manual-comparison';
import { emptyComparisonDraft } from '../src/renderer/comparison-draft';
import { setShellApi } from '../src/renderer/shell-api';
import { getCopy } from '../src/shared/copy';
import { mountDom } from './ui/dom-harness';
import { comparisonRecord } from './ui/comparison-dom';

function database() {
  const db = DesktopDatabase.open(':memory:'); db.meta.put('deviceId', 'local');
  const drafts = new DraftRepository(db.state, db.meta);
  const listeners = new Set<() => void>();
  setShellApi({
    listDrafts: async (kind: any, context: string) => ({ epoch: drafts.epoch(), deviceId: 'local', drafts: drafts.list(kind, context) }),
    saveDraft: async (input: unknown, epoch: number) => { const value = drafts.save(input, epoch); listeners.forEach(fn => fn()); return value; },
    removeDraft: async (id: string, version: number, epoch: number) => { const ok = drafts.remove(id, version, epoch); listeners.forEach(fn => fn()); return ok; },
    onDraftsChanged: (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; }
  } as any);
  return { db, drafts, close: () => { setShellApi(null); db.close(); } };
}

test('production prompt hook keeps edits made after send and clears only the accepted draft version', async () => {
  const d = database(); let flow!: ReturnType<typeof usePromptDraft>;
  function Fixture() { flow = usePromptDraft(getCopy('en')); return <span>{flow.text}</span>; }
  const h = await mountDom(<Fixture />);
  try {
    await act(async () => flow.setText('send this'));
    const sentRevision = flow.revision.current;
    let saved: Awaited<ReturnType<typeof flow.flushDraft>> = null;
    await act(async () => { saved = await flow.flushDraft(); });
    assert.equal(saved !== null, true);
    await act(async () => { flow.setText('later draft'); });
    await act(async () => { flow.clearSent(sentRevision, saved); });
    assert.equal(flow.text, 'later draft');
    assert.equal(d.drafts.list().length, 1);
    await act(async () => { saved = await flow.flushDraft(); });
    await act(async () => { flow.clearSent(flow.revision.current, saved); });
    assert.equal(flow.text, '');
    assert.equal(d.drafts.list().length, 0);
  } finally { await h.close(); d.close(); }
});

test('successful prompt cleanup clears the editor while its draft receipt is still pending', async () => {
  const d = database(); let flow!: ReturnType<typeof usePromptDraft>;
  function Fixture() { flow = usePromptDraft(getCopy('en')); return <span>{flow.text}</span>; }
  const h = await mountDom(<Fixture />);
  try {
    await act(async () => flow.setText('confirmed prompt'));
    type DraftResult = Awaited<ReturnType<typeof flow.flushDraft>>;
    let saved: DraftResult = null;
    await act(async () => { saved = await flow.flushDraft(); });
    let finish!: (value: DraftResult) => void;
    const receipt = new Promise<DraftResult>(resolve => { finish = resolve; });
    await act(async () => { flow.clearSent(flow.revision.current, receipt); });
    assert.equal(flow.text, '', 'a pending draft acknowledgement must not hold the sent prompt in the editor');
    assert.equal(d.drafts.list().length, 1);
    await act(async () => { finish(saved); await Promise.resolve(); });
    assert.equal(d.drafts.list().length, 0);
  } finally { await h.close(); d.close(); }
});

test('comparison remote copy is explicit, retains source identity and rejects a different archive', async () => {
  const d = database();
  const remote = new DraftRepository(d.db.state, d.db.meta, { deviceId: () => 'remote' });
  const input = { ...emptyComparisonDraft(comparisonRecord), judgment: 'remote manual conclusion' };
  remote.save({ kind: 'comparison', context: comparisonRecord.id, title: 'comparison', content: input,
    sourceUpdatedAt: comparisonRecord.updatedAt });
  let flow!: ReturnType<typeof useComparisonWorksheet>;
  function Fixture() { flow = useComparisonWorksheet(comparisonRecord); return <span>{flow.draft?.judgment}</span>; }
  const h = await mountDom(<Fixture />);
  try {
    assert.equal(flow.draft?.judgment, '');
    const copy = flow.recovery.drafts[0]; assert.equal(copy !== undefined, true);
    await act(async () => { assert.equal(await flow.recovery.onRestore(copy), true); });
    assert.equal(flow.draft?.judgment, 'remote manual conclusion');
    assert.equal(flow.draft?.archiveId, comparisonRecord.id);
    const wrong = remote.save({ kind: 'comparison', context: comparisonRecord.id, title: '', content: { ...input, archiveId: 'other' } });
    await act(async () => { flow.recovery.onRetry?.(); await Promise.resolve(); });
    // The client refuses an unlisted/mismatched version before the editor can bind it.
    assert.equal(await flow.recovery.onRestore(wrong), false);
    assert.equal(flow.draft?.archiveId, comparisonRecord.id);
  } finally { await h.close(); d.close(); }
});

test('leaving a comparison before debounce still persists its latest manual work', async () => {
  const d = database(); let flow!: ReturnType<typeof useComparisonWorksheet>;
  function Fixture() { flow = useComparisonWorksheet(comparisonRecord); return <span>{flow.draft?.judgment}</span>; }
  const h = await mountDom(<Fixture />);
  try {
    await act(async () => flow.change({ ...flow.draft!, judgment: 'fast navigation work' }));
    await h.close(); await Promise.resolve(); await Promise.resolve();
    assert.equal(d.drafts.list('comparison', comparisonRecord.id).length, 1);
    assert.equal((d.drafts.list('comparison', comparisonRecord.id)[0].content as { judgment: string }).judgment, 'fast navigation work');
  } finally { d.close(); }
});
