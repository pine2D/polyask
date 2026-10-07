import assert from 'node:assert/strict';
import test from 'node:test';
import { act } from 'react';
import { comparisonCopy as copy, comparisonMount, comparisonRecord, comparisonWait } from './ui/comparison-dom';

const quote = 'Claude paragraph 2.';
async function addQuote(h: Awaited<ReturnType<typeof comparisonMount>>, value = quote) {
  const open = h.document.querySelector<HTMLButtonElement>('.archive-compare-column .answer-excerpt-open');
  assert.equal(!!open, true); await h.click(open!);
  const textarea = h.document.querySelector<HTMLTextAreaElement>('[name=answer-excerpt-original]')!;
  await act(async () => { textarea.focus(); const first = textarea.value.indexOf(value);
    textarea.setSelectionRange(first, first + value.length); h.document.dispatchEvent(new h.window.Event('selectionchange')); });
  await h.click(h.button('Use this excerpt')!);
  const add = h.button('Add to manual comparison'); assert.equal(!!add, true, 'selected source can enter an explicit manual comparison');
  await h.click(add!);
}
const field = (h: Awaited<ReturnType<typeof comparisonMount>>, name: string) => h.document.querySelector<HTMLTextAreaElement>(`[name=${name}]`)!;

test('manual comparison starts empty, classifies literal quotes by the user and never writes a winner', async () => {
  const h = await comparisonMount(); try {
    const details = h.document.querySelector<HTMLDetailsElement>('details.manual-comparison');
    assert.equal(!!details, true, 'comparison has a manual worksheet disclosure'); assert.equal(details!.open, false);
    await h.click(details!.querySelector<HTMLElement>('summary')!);
    assert.equal(details!.textContent?.includes('Not organized'), true);
    assert.equal(h.document.querySelectorAll('.manual-comparison [name=manual-category]').length, 8);
    await addQuote(h);
    const category = h.document.querySelector<HTMLInputElement>('[name=manual-category][data-source-index="0"][value=evidence]')!;
    await h.click(category);
    assert.equal(field(h, 'comparison-excerpt-0').value, quote);
    assert.equal(h.document.querySelector('.manual-comparison [data-source-index="0"]')?.textContent?.includes('[S1] Claude'), true);
    assert.equal(h.writes + h.decisionWrites, 0);
  } finally { await h.close(); }
});

test('forming a decision retains only manual judgment and notes with literal source evidence and does not save automatically', async () => {
  const h = await comparisonMount(); try {
    await addQuote(h);
    await h.input(field(h, 'comparison-judgment'), 'My decision is to validate the first option.');
    await h.input(field(h, 'comparison-next-step'), 'Check the measurement with the owner.');
    await h.input(field(h, 'comparison-note-conditions-0'), 'Only under the stated laboratory conditions.');
    await h.input(field(h, 'comparison-note-cost-0'), 'Manual estimate: two hours to verify.');
    const form = h.button('Form decision draft'); assert.equal(!!form, true); await h.click(form!);
    await comparisonWait(() => h.document.querySelector('.decision-editor'));
    assert.equal(field(h, 'decision-conclusion').value, 'My decision is to validate the first option.');
    assert.equal(field(h, 'decision-uncertainties').value.includes('[S1] Claude'), true);
    assert.equal(field(h, 'decision-uncertainties').value.includes('laboratory conditions'), true);
    assert.equal(field(h, 'decision-rationale').value.includes('two hours to verify'), true);
    assert.equal(field(h, 'decision-nextStep').value, 'Check the measurement with the owner.');
    assert.equal(field(h, 'decision-evidence-0').value, quote);
    assert.equal(h.decisionWrites + h.writes, 0);
  } finally { await h.close(); }
});

for (const accept of [false, true]) test(`a second disjoint quote from one source is replaced only explicitly (${accept ? 'accept' : 'cancel'})`, async () => {
  const h = await comparisonMount(); try {
    await addQuote(h); await h.input(field(h, 'comparison-note-evidence-0'), 'Keep this manual evidence note.');
    await addQuote(h, 'Claude paragraph 3.');
    assert.equal(!!h.document.querySelector('.confirm-dialog'), true);
    await h.click(h.button(accept ? 'Use selected excerpt' : copy.cancel)!);
    assert.equal(field(h, 'comparison-excerpt-0').value, accept ? 'Claude paragraph 3.' : quote);
    assert.equal(field(h, 'comparison-note-evidence-0').value, 'Keep this manual evidence note.');
    assert.equal(h.writes + h.decisionWrites, 0);
  } finally { await h.close(); }
});

test('switching comparison sources keeps each manual note attached to its original saved answer', async () => {
  const h = await comparisonMount(); try {
    await addQuote(h); await h.input(field(h, 'comparison-note-conditions-0'), 'Claude condition, not Kimi condition.');
    await h.choose(copy.leftAnswer, 'Kimi');
    assert.equal(field(h, 'comparison-note-conditions-2').value, '');
    await h.choose(copy.leftAnswer, 'Claude');
    assert.equal(field(h, 'comparison-note-conditions-0').value, 'Claude condition, not Kimi condition.');
  } finally { await h.close(); }
});

test('switching saved results retains the session worksheet and source revisions require rechecking quotes', async () => {
  const h = await comparisonMount(); try {
    await addQuote(h); await h.input(field(h, 'comparison-judgment'), 'Retain my session judgment.');
    const pick = (title: string) => [...h.document.querySelectorAll<HTMLButtonElement>('.folder-content-list .archive-list button')]
      .find(node => node.textContent?.includes(title))!;
    await h.click(pick('Other saved result')); await h.click(pick(comparisonRecord.task));
    await h.click(h.document.querySelector<HTMLDetailsElement>('details.manual-comparison')!.querySelector<HTMLElement>('summary')!);
    assert.equal(field(h, 'comparison-judgment').value, 'Retain my session judgment.');
    h.replace({ ...comparisonRecord, updatedAt: 101, results: comparisonRecord.results.map((source, index) =>
      index === 0 ? { ...source, text: 'New unrelated Claude text.' } : source) });
    await h.click(h.document.querySelector<HTMLButtonElement>('.archive-detail-actions button')!);
    await comparisonWait(() => h.document.querySelector('.manual-source-changed'));
    assert.equal(field(h, 'comparison-judgment').value, 'Retain my session judgment.');
    assert.equal(h.button('Form decision draft')!.disabled, true);
  } finally { await h.close(); }
});

test('forming a draft keeps the existing unsaved metadata guard and cancel does not erase either editor', async () => {
  const h = await comparisonMount(); try {
    await addQuote(h); await h.input(field(h, 'comparison-judgment'), 'Keep my judgment too.');
    await h.input(field(h, 'archive-note'), 'Uncommitted metadata note.');
    await h.click(h.button('Form decision draft')!);
    await comparisonWait(() => h.document.querySelector('.confirm-dialog'));
    const cancel = [...h.document.querySelectorAll<HTMLButtonElement>('.confirm-dialog button')].find(node => node.textContent === copy.cancel)!;
    await h.click(cancel);
    assert.equal(field(h, 'archive-note').value, 'Uncommitted metadata note.');
    assert.equal(field(h, 'comparison-judgment').value, 'Keep my judgment too.');
    assert.equal(h.writes + h.decisionWrites, 0);
  } finally { await h.close(); }
});
