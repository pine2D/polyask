import assert from 'node:assert/strict';
import test from 'node:test';
import { act } from 'react';
import { comparisonCopy as copy, comparisonMount, comparisonWait } from './ui/comparison-dom';

async function addQuote(h: Awaited<ReturnType<typeof comparisonMount>>, value: string) {
  await h.click(h.document.querySelector<HTMLButtonElement>('.archive-compare-column .answer-excerpt-open')!);
  const text = h.document.querySelector<HTMLTextAreaElement>('[name=answer-excerpt-original]')!;
  await act(async () => { text.focus(); const first = text.value.indexOf(value); text.setSelectionRange(first, first + value.length);
    h.document.dispatchEvent(new h.window.Event('selectionchange')); });
  await h.click(h.button(copy.excerptUseSelection)!); await h.click(h.button(copy.excerptManualCompare)!);
}

test('adding an existing source/excerpt/topic twice rejects duplication without replacing prior labor', async () => {
  const h = await comparisonMount(); try {
    await addQuote(h, 'Claude paragraph 2.'); await addQuote(h, 'Claude paragraph 3.');
    await addQuote(h, 'Claude paragraph 2.');
    const fields = [...h.document.querySelectorAll<HTMLTextAreaElement>('.manual-quote textarea')];
    assert.deepEqual(fields.map(field => field.value), ['Claude paragraph 2.', 'Claude paragraph 3.']);
    assert.equal(h.document.querySelector('.manual-comparison')?.textContent?.includes(copy.decisionEvidenceDuplicate),true);
    assert.equal(h.writes + h.decisionWrites, 0);
  } finally { await h.close(); }
});

test('forming a decision from oversized manual judgment preserves every character and shows the existing field error immediately', async () => {
  const h = await comparisonMount(); try {
    await addQuote(h, 'Claude paragraph 2.');
    const judgment = 'x'.repeat(4001);
    await h.input(h.document.querySelector<HTMLTextAreaElement>('[name=comparison-judgment]')!, judgment);
    await h.click(h.button(copy.manualFormDecision)!); await comparisonWait(() => h.document.querySelector('.decision-editor'));
    const field = h.document.querySelector<HTMLTextAreaElement>('[name=decision-conclusion]')!;
    assert.equal(field.value === judgment, true, 'manual judgment must not be clipped');
    assert.equal(field.getAttribute('aria-invalid'), 'true', 'existing 4,000-character validation appears before save');
    assert.equal(!!h.document.querySelector('.decision-field-error'), true);
    assert.equal(h.writes + h.decisionWrites, 0);
  } finally { await h.close(); }
});
