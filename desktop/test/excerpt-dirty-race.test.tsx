import assert from 'node:assert/strict';
import test from 'node:test';
import { act } from 'react';
import type { ArchiveRecord } from '../src/shared/archive';
import { comparisonCopy as copy, comparisonMount, comparisonRecord, comparisonWait } from './ui/comparison-dom';

const decisionButton = (document: Document, accept: boolean) => [...document.querySelectorAll<HTMLButtonElement>('.confirm-dialog button')]
  .find(node => node.textContent === (accept ? copy.decisionConfirm : copy.cancel))!;

async function begin(h: Awaited<ReturnType<typeof comparisonMount>>) {
  await h.click(h.document.querySelector<HTMLButtonElement>('.archive-compare-column .answer-excerpt-open')!);
  const original = h.document.querySelector<HTMLTextAreaElement>('[name=answer-excerpt-original]')!;
  const excerpt = 'Claude paragraph 2.';
  await act(async () => { original.focus(); const start = original.value.indexOf(excerpt);
    original.setSelectionRange(start, start + excerpt.length); h.document.dispatchEvent(new h.window.Event('selectionchange')); });
  await h.click(h.button(copy.excerptUseSelection)!);
  let reads = 0;
  const pending: ((record: ArchiveRecord | null) => void)[] = [];
  h.readWith(() => { reads++; return new Promise(resolve => pending.push(resolve)); });
  await h.click(h.button(copy.excerptFollowUp)!);
  await h.click(h.document.querySelector<HTMLElement>('.archive-metadata summary')!);
  await h.input(h.document.querySelector<HTMLTextAreaElement>('[name=archive-note]')!, 'A new note during the source read.');
  await act(async () => pending.shift()!(comparisonRecord));
  await comparisonWait(() => h.document.querySelector('.confirm-dialog'));
  assert.equal(h.document.querySelector('.synthesis-workspace') === null, true, 'late source reads cannot discard new metadata');
  return { pending, get reads() { return reads; } };
}

for (const accept of [false, true]) test(`excerpt navigation rechecks a new metadata draft after its source read (${accept ? 'accept' : 'cancel'})`, async () => {
  const h = await comparisonMount();
  try {
    const source = await begin(h);
    await h.click(decisionButton(h.document, accept));
    if (!accept) {
      assert.equal(h.document.querySelector<HTMLTextAreaElement>('[name=archive-note]')!.value, 'A new note during the source read.');
      assert.equal(h.document.querySelector('.synthesis-workspace') === null, true);
      assert.equal(source.reads, 1);
    } else {
      await comparisonWait(() => source.reads === 2);
      assert.equal(h.document.querySelector('.synthesis-workspace') === null, true, 'approved discard must revalidate the saved source');
      await act(async () => source.pending.shift()!(comparisonRecord));
      await comparisonWait(() => h.document.querySelector('[name=follow-up-excerpt]'));
      assert.equal(h.document.querySelector<HTMLTextAreaElement>('[name=follow-up-excerpt]')!.value, 'Claude paragraph 2.');
      assert.equal(h.document.querySelector('.confirm-dialog') === null, true);
    }
    assert.equal(h.writes + h.decisionWrites, 0);
  } finally { await h.close(); }
});

test('a saved source changed while discard confirmation was pending cannot open an obsolete excerpt', async () => {
  const h = await comparisonMount();
  try {
    const source = await begin(h); await h.click(decisionButton(h.document, true));
    await comparisonWait(() => source.reads === 2);
    await act(async () => source.pending.shift()!({ ...comparisonRecord, updatedAt: comparisonRecord.updatedAt + 1 }));
    await comparisonWait(() => h.document.querySelector('.archive-status')?.textContent?.includes(copy.synthesisSourceVersionChanged));
    assert.equal(h.document.querySelector('.synthesis-workspace') === null, true);
    assert.equal(h.writes + h.decisionWrites, 0);
  } finally { await h.close(); }
});

test('another draft created during the approved source recheck still requires its own discard decision', async () => {
  const h = await comparisonMount();
  try {
    const source = await begin(h); await h.click(decisionButton(h.document, true));
    await comparisonWait(() => source.reads === 2);
    await h.input(h.document.querySelector<HTMLTextAreaElement>('[name=archive-note]')!, 'Keep the second new note.');
    await act(async () => source.pending.shift()!(comparisonRecord));
    await comparisonWait(() => h.document.querySelector('.confirm-dialog'));
    await h.click(decisionButton(h.document, false));
    assert.equal(h.document.querySelector<HTMLTextAreaElement>('[name=archive-note]')!.value, 'Keep the second new note.');
    assert.equal(h.document.querySelector('.synthesis-workspace') === null, true);
    assert.equal(source.reads, 2); assert.equal(h.writes + h.decisionWrites, 0);
  } finally { await h.close(); }
});
