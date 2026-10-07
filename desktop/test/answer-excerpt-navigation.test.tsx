import assert from 'node:assert/strict';
import test from 'node:test';
import { act } from 'react';
import { createSynthesisDraftStore } from '../src/renderer/synthesis-draft';
import { comparisonCopy as copy, comparisonMount, comparisonRecord, comparisonWait } from './ui/comparison-dom';
import type { ArchiveRecord } from '../src/shared/archive';

const selectedText = 'Claude paragraph 2.';
async function selectExcerpt(h: Awaited<ReturnType<typeof comparisonMount>>) {
  const open = h.document.querySelector<HTMLButtonElement>('.archive-compare-column .answer-excerpt-open');
  assert.equal(!!open, true, 'comparison exposes saved original selection'); await h.click(open!);
  const textarea = h.document.querySelector<HTMLTextAreaElement>('[name=answer-excerpt-original]')!;
  await act(async () => { textarea.focus(); const start = textarea.value.indexOf(selectedText);
    textarea.setSelectionRange(start, start + selectedText.length); h.document.dispatchEvent(new h.window.Event('selectionchange')); });
  await h.click(h.button('Use this excerpt')!);
}
const field = (doc: Document, name: string) => doc.querySelector<HTMLTextAreaElement>(`[name=${name}]`)!;

test('a confirmed comparison excerpt opens a follow-up with literal text and an unselected target', async () => {
  const h = await comparisonMount(); try {
    await selectExcerpt(h); await h.click(h.button('Follow up on excerpt')!);
    await comparisonWait(() => field(h.document, 'follow-up-excerpt'));
    assert.equal(field(h.document, 'follow-up-excerpt').value, selectedText);
    assert.equal(field(h.document, 'follow-up-original').value === comparisonRecord.results[0].text, true);
    assert.equal(h.document.querySelector('[name=synthesis-target]')!.textContent, copy.synthesisTargetMissing);
    assert.equal(h.document.querySelector<HTMLButtonElement>('footer button')!.disabled, true);
    assert.equal(h.writes + h.decisionWrites, 0);
  } finally { await h.close(); }
});

test('a confirmed excerpt seeds a draft decision evidence without writing a card', async () => {
  const h = await comparisonMount(); try {
    await selectExcerpt(h); await h.click(h.button('Use as evidence')!);
    await comparisonWait(() => h.document.querySelector('.decision-editor'));
    assert.equal(h.document.querySelector<HTMLTextAreaElement>('[name=decision-evidence-0]')?.value, selectedText);
    assert.equal(h.document.querySelector('.decision-evidence')?.textContent?.includes('[S1]'), true);
    assert.equal(h.decisionWrites, 0); assert.equal(h.writes, 0);
  } finally { await h.close(); }
});

test('a delayed source check cannot open an excerpt editor after selecting another saved result', async () => {
  const h = await comparisonMount(); let finish!: (record: ArchiveRecord | null) => void;
  try {
    await selectExcerpt(h); h.readWith(() => new Promise(resolve => { finish = resolve; }));
    await h.click(h.button('Follow up on excerpt')!);
    assert.equal(!!h.document.querySelector('.synthesis-workspace'), false, 'source recheck completes before navigation');
    const other = [...h.document.querySelectorAll<HTMLButtonElement>('.folder-content-list .archive-list button')]
      .find(node => node.textContent?.includes('Other saved result'))!; await h.click(other);
    await act(async () => finish(comparisonRecord));
    assert.equal(!!h.document.querySelector('.synthesis-workspace'), false);
    assert.equal(h.document.querySelector('.archive-detail h1')!.textContent, 'Other saved result');
    assert.equal(h.writes + h.decisionWrites, 0);
  } finally { await h.close(); }
});

test('a revised source cannot be used for a new excerpt action and preserves the selected saved result', async () => {
  const h = await comparisonMount(); try {
    await selectExcerpt(h); h.readWith(async () => ({ ...comparisonRecord, updatedAt: comparisonRecord.updatedAt + 1 }));
    await h.click(h.button('Follow up on excerpt')!);
    await comparisonWait(() => h.document.querySelector('.archive-status')?.textContent?.includes(copy.synthesisSourceVersionChanged));
    assert.equal(!!h.document.querySelector('.synthesis-workspace'), false); assert.equal(h.writes + h.decisionWrites, 0);
  } finally { await h.close(); }
});

for (const accept of [false, true]) test(`a restored follow-up excerpt requires an explicit replacement (${accept ? 'accept' : 'cancel'})`, async () => {
  const store = createSynthesisDraftStore();
  store.save(comparisonRecord, { selectedHosts: ['claude.ai'], targetSite: 'kimi', tier: 'think',
    instruction: 'Keep my carefully written question.', excerpt: 'Claude paragraph 1.' }, 'claude.ai');
  const h = await comparisonMount({ synthesisDrafts: store }); try {
    await selectExcerpt(h); await h.click(h.button('Follow up on excerpt')!);
    await comparisonWait(() => h.document.querySelector('.confirm-dialog'));
    assert.equal(!!h.document.querySelector('.synthesis-workspace'), false);
    await h.click(h.button(accept ? 'Use selected excerpt' : copy.cancel)!);
    if (accept) {
      await comparisonWait(() => field(h.document, 'follow-up-excerpt'));
      assert.equal(field(h.document, 'follow-up-excerpt').value, selectedText);
      assert.equal(field(h.document, 'synthesis-instruction').value, 'Keep my carefully written question.');
      assert.equal(h.document.querySelector('[name=synthesis-target]')!.textContent?.includes('Kimi'), true);
      assert.equal(h.document.querySelector('[name=synthesis-tier]')!.textContent?.includes(copy.think), true);
    } else {
      assert.equal(!!h.document.querySelector('.synthesis-workspace'), false);
      assert.equal(store.restore(comparisonRecord, 'claude.ai')?.excerpt, 'Claude paragraph 1.');
    }
    assert.equal(h.writes + h.decisionWrites, 0);
  } finally { await h.close(); }
});
