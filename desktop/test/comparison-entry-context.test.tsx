import assert from 'node:assert/strict';
import test from 'node:test';
import { act } from 'react';
import { comparisonCopy as copy, comparisonMount, comparisonWait } from './ui/comparison-dom';
import { focusableControls } from '../src/renderer/focusable-controls';
import { createLibrarySessionStore } from '../src/renderer/library-session';

test('comparison starts with a compact question and explicitly reveals the existing record tools', async () => {
  const h = await comparisonMount();
  try {
    const context = h.document.querySelector<HTMLDetailsElement>('.archive-record-context');
    assert.equal(context === null, false, 'comparison keeps secondary record context behind a disclosure');
    assert.equal(context!.open, false);
    assert.equal(context!.querySelector('summary')?.textContent?.includes('Compare saved answers'), true);
    await h.click(context!.querySelector('summary')!);
    assert.equal(context!.open, true);
    await h.input(h.document.querySelector<HTMLTextAreaElement>('[name=archive-note]')!, 'Keep this record note.');
    await h.click(context!.querySelector('summary')!);
    await h.click(context!.querySelector('summary')!);
    assert.equal(h.document.querySelector<HTMLTextAreaElement>('[name=archive-note]')!.value, 'Keep this record note.');
    await h.click(context!.querySelector('summary')!);
    assert.equal(context!.open, false);
    await h.click(h.document.querySelector<HTMLButtonElement>('.library-view-switch button:first-child')!);
    assert.equal(h.document.querySelector('.confirm-dialog') !== null, true, 'collapsing tools does not bypass unsaved metadata protection');
    assert.equal(focusableControls(h.document.querySelector<HTMLElement>('.confirm-dialog')!).length > 0, true, 'the confirmation is reachable while record context is collapsed');
    await h.click(h.button(copy.cancel)!);
    assert.equal(h.document.querySelector('.archive-detail')!.getAttribute('data-view'), 'compare');
    assert.equal(h.writes + h.decisionWrites, 0);
  } finally { await h.close(); }
});

test('returning from supplementary analysis restores expanded comparison context and its entry focus', async () => {
  const session = createLibrarySessionStore(), h = await comparisonMount({ session });
  try {
    await h.click(h.document.querySelector<HTMLElement>('.archive-record-context > summary')!);
    await comparisonWait(() => session.read().reader?.comparisonContextExpanded);
    await h.click(h.button(copy.synthesisAction)!);
    await h.click(h.button(copy.synthesisCancel)!);
    assert.equal(h.document.querySelector<HTMLDetailsElement>('.archive-record-context')!.open, true, 'the editor return preserves the visible entry context');
    assert.equal(h.document.activeElement === h.button(copy.synthesisAction), true);
    assert.equal(focusableControls(h.document.querySelector<HTMLElement>('.archive-detail-pane')!).includes(h.button(copy.synthesisAction)!), true);
    assert.equal(h.writes + h.decisionWrites, 0);
  } finally { await h.close(); }
});

test('empty manual comparison selects an exact saved excerpt in place and restores a usable focus', async () => {
  const h = await comparisonMount();
  try {
    await h.click(h.document.querySelector<HTMLButtonElement>('.comparison-manual-entry')!);
    const entry = h.document.querySelector<HTMLButtonElement>('.manual-comparison-source .answer-excerpt-open');
    assert.equal(entry === null, false, 'an empty source offers original selection without leaving the worksheet');
    entry!.focus(); await h.click(entry!);
    const original = h.document.querySelector<HTMLTextAreaElement>('[name=answer-excerpt-original]')!;
    const quote = 'Claude paragraph 2.', start = original.value.indexOf(quote);
    await act(async () => { original.focus(); original.setSelectionRange(start, start + quote.length);
      h.document.dispatchEvent(new h.window.Event('selectionchange')); });
    await h.click(h.button(copy.excerptUseSelection)!);
    await h.click(h.button(copy.excerptManualCompare)!);
    const selected = h.document.querySelector<HTMLTextAreaElement>('[name=comparison-excerpt-0]')!;
    assert.equal(selected.value, quote);
    assert.equal(h.document.activeElement === selected, true, 'the removed empty-state opener hands focus to the chosen excerpt');
    assert.equal(h.writes + h.decisionWrites, 0);
  } finally { await h.close(); }
});

test('manual categories disclose notes on demand and retain notes across closing and source changes', async () => {
  const h = await comparisonMount();
  try {
    await h.click(h.document.querySelector<HTMLButtonElement>('.comparison-manual-entry')!);
    const categories = [...h.document.querySelectorAll<HTMLDetailsElement>('details.manual-category')];
    assert.equal(categories.length, 8);
    assert.equal(categories.every(node => !node.open), true, 'an empty worksheet does not present eight open note fields');
    await h.click(categories[0].querySelector('summary')!);
    const note = categories[0].querySelector('textarea')!;
    await h.input(note, 'My independent note without a quote.');
    await h.click(categories[0].querySelector('summary')!);
    assert.equal(categories[0].open, false);
    await h.choose(copy.leftAnswer, 'Kimi'); await h.choose(copy.leftAnswer, 'Claude');
    const restored = h.document.querySelector<HTMLTextAreaElement>('[name=comparison-note-conclusion-0]')!;
    assert.equal(restored.value, 'My independent note without a quote.');
    assert.equal(restored.closest<HTMLDetailsElement>('details')!.open, true, 'saved notes are visible when returning to their source');
    assert.equal(h.writes + h.decisionWrites, 0);
  } finally { await h.close(); }
});
