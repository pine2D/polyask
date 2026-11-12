import assert from 'node:assert/strict';
import test from 'node:test';
import { act } from 'react';
import { comparisonCopy as copy, comparisonMount } from './ui/comparison-dom';
import { readingGeometry } from './ui/reading-geometry';

test('comparison fits actual pane space, remeasures layout, and does not resize while outer scrolling', async () => {
  const geometry = readingGeometry(), h = await comparisonMount({ configure: geometry.configure });
  try {
    const compare = h.document.querySelector<HTMLElement>('.archive-compare')!;
    assert.equal(compare.style.getPropertyValue('--comparison-reading-height'), '374px');
    const pane = h.document.querySelector<HTMLElement>('.archive-detail-pane')!;
    await h.scroll(pane, 150); geometry.resize(); await geometry.flush();
    assert.equal(compare.style.getPropertyValue('--comparison-reading-height'), '374px', 'content coordinates are independent of outer scroll');
    geometry.metrics.paneHeight = 600; geometry.resize(); geometry.resize();
    assert.equal(geometry.pending, 1);
    await geometry.flush(); assert.equal(compare.style.getPropertyValue('--comparison-reading-height'), '187px');
    geometry.metrics.paneHeight = 300; geometry.resize(); await geometry.flush();
    assert.equal(compare.style.getPropertyValue('--comparison-reading-height'), '160px', 'short windows preserve a usable reading floor');
    assert.equal(h.writes, 0);
  } finally { await h.close(); }
  assert.equal(geometry.pending, 0); assert.equal(geometry.observed, 0);
});

test('manual comparison has a direct entry that opens and focuses the existing worksheet', async () => {
  const h = await comparisonMount();
  try {
    const entry = h.document.querySelector<HTMLButtonElement>('.comparison-manual-entry');
    assert.equal(entry !== null, true);
    await h.click(entry!);
    const details = h.document.querySelector<HTMLDetailsElement>('.manual-comparison')!;
    assert.equal(details.open, true);
    assert.equal(h.document.activeElement === details.querySelector('summary'), true);
    await h.input(h.document.querySelector<HTMLTextAreaElement>('[name=comparison-judgment]')!, 'Keep my judgment');
    assert.equal(h.document.querySelector<HTMLElement>('.archive-compare-grid')!.hidden, true, 'notes use the same workspace as answers');
    await h.click(entry!);
    assert.equal(details.open, false);
    assert.equal(h.document.querySelector<HTMLElement>('.archive-compare-grid')!.hidden, false);
    assert.equal(h.document.activeElement === entry, true, 'returning to answers retains a usable keyboard focus');
    await h.click(entry!);
    assert.equal(h.document.querySelector<HTMLTextAreaElement>('[name=comparison-judgment]')?.value, 'Keep my judgment');
    await h.click(h.document.querySelector<HTMLButtonElement>('.library-view-switch button:first-child')!); await h.click(h.button(copy.libraryCompare)!);
    assert.equal(h.document.querySelector<HTMLDetailsElement>('.manual-comparison')!.open, true, 'returning restores the active worksheet');
    assert.equal(h.document.querySelector<HTMLTextAreaElement>('[name=comparison-judgment]')?.value, 'Keep my judgment');
    assert.equal(h.writes, 0); assert.equal(h.decisionWrites, 0);
  } finally { await h.close(); }
});

test('split evidence dock keeps both answer columns visible alongside the worksheet and auto-docks on wide excerpt selection', async () => {
  const h = await comparisonMount({ detailWidth: 1280 });
  try {
    const compare = () => h.document.querySelector<HTMLElement>('.archive-compare')!;
    const dockToggle = h.document.querySelector<HTMLButtonElement>('.comparison-dock-toggle')!;
    const grid = h.document.querySelector<HTMLElement>('.archive-compare-grid')!;
    const details = h.document.querySelector<HTMLDetailsElement>('.manual-comparison')!;
    assert.equal(dockToggle.getAttribute('aria-pressed'), 'false');
    await h.click(dockToggle);
    assert.equal(dockToggle.getAttribute('aria-pressed'), 'true');
    assert.equal(compare().getAttribute('data-evidence-dock'), 'true');
    assert.equal(details.open, true);
    assert.equal(grid.hidden, false, 'docked mode keeps both answer columns visible next to the evidence dock');
    await h.click(dockToggle);
    assert.equal(dockToggle.getAttribute('aria-pressed'), 'false');
    assert.equal(details.open, false);
    assert.equal(grid.hidden, false);

    // Wide-screen excerpt selection auto-opens the split evidence dock without hiding the answers.
    await h.click(h.document.querySelector<HTMLButtonElement>('.archive-compare-column .answer-excerpt-open')!);
    const textarea = h.document.querySelector<HTMLTextAreaElement>('[name=answer-excerpt-original]')!;
    const quote = 'Claude paragraph 2.';
    await act(async () => {
      textarea.focus();
      const first = textarea.value.indexOf(quote);
      textarea.setSelectionRange(first, first + quote.length);
      h.document.dispatchEvent(new h.window.Event('selectionchange'));
    });
    await h.click(h.button('Use this excerpt')!);
    await h.click(h.button('Add to manual comparison')!);
    assert.equal(compare().getAttribute('data-evidence-dock'), 'true');
    assert.equal(details.open, true);
    assert.equal(grid.hidden, false);
    assert.equal(h.document.querySelector<HTMLTextAreaElement>('[name=comparison-excerpt-0]')?.value, quote);
    assert.equal(h.writes, 0);
  } finally { await h.close(); }
});
