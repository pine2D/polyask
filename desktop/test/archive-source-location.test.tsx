import assert from 'node:assert/strict';
import test from 'node:test';
import { comparisonCopy as copy, comparisonMount, comparisonRecord } from './ui/comparison-dom';
import { readingGeometry } from './ui/reading-geometry';

const current = (document: Document) => [...document.querySelectorAll('.archive-answer-nav [aria-current=location]')]
  .map(link => link.getAttribute('href')).join(',');

test('current reading source follows the sticky boundary without changing the best answer or focus', async () => {
  const geometry = readingGeometry(), h = await comparisonMount({ startInRead: true, configure: geometry.configure });
  try {
    await geometry.flush(); assert.equal(current(h.document), '#archive-answer-0');
    const pane = h.document.querySelector<HTMLElement>('.archive-detail-pane')!;
    const firstLink = h.document.querySelector<HTMLAnchorElement>('.archive-answer-nav a')!; firstLink.focus();
    await h.scroll(pane, 700); await geometry.flush();
    assert.equal(current(h.document), '#archive-answer-1');
    assert.equal(h.document.activeElement === firstLink, true);
    await h.scroll(pane, 1300); await geometry.flush(); assert.equal(current(h.document), '#archive-answer-2');
    assert.equal(h.document.querySelectorAll('.archive-answer-nav [data-best=true]').length, 0);
    assert.equal(h.writes, 0);
    geometry.metrics.starts[2] = 2000; geometry.resize(); geometry.resize();
    assert.equal(geometry.pending, 1); await geometry.flush(); assert.equal(current(h.document), '#archive-answer-1');
  } finally { await h.close(); }
  assert.equal(geometry.pending, 0); assert.equal(geometry.observed, 0);
});

test('best answer and current location coexist and returning from comparison recomputes the saved position', async () => {
  const geometry = readingGeometry(), h = await comparisonMount({ startInRead: true, configure: geometry.configure });
  try {
    await geometry.flush();
    const mark = [...h.document.querySelectorAll<HTMLButtonElement>('.archive-answer-actions button')].find(b => b.getAttribute('aria-label') === copy.markBest)!;
    await h.click(mark); await geometry.flush();
    const link = h.document.querySelector('.archive-answer-nav a')!;
    assert.equal(link.getAttribute('data-best'), 'true'); assert.equal(link.getAttribute('aria-current'), 'location');
    await h.scroll(h.document.querySelector<HTMLElement>('.archive-detail-pane')!, 700); await geometry.flush();
    await h.click(h.button(copy.libraryCompare)!); await geometry.flush(); assert.equal(current(h.document), '');
    await h.click(h.document.querySelector<HTMLButtonElement>('.library-view-switch button:first-child')!); await geometry.flush(); assert.equal(current(h.document), '#archive-answer-1');
    assert.equal(h.document.querySelector('.archive-answer-nav [data-best=true]')?.getAttribute('href'), '#archive-answer-0');
    assert.equal(h.writes, 1, 'only the explicit best-answer action writes');
    h.replace({ ...comparisonRecord, results: [] });
    await h.click(h.document.querySelector<HTMLButtonElement>('.archive-detail-actions button')!); geometry.resize(); await geometry.flush();
    assert.equal(current(h.document), '');
  } finally { await h.close(); }
});

test('leaving reading cancels its scheduled position work', async () => {
  const geometry = readingGeometry(), h = await comparisonMount({ startInRead: true, configure: geometry.configure });
  try {
    await geometry.flush(); geometry.resize(); assert.equal(geometry.pending, 1);
    await h.click(h.button(copy.librarySynthesis)!);
    assert.equal(geometry.pending, 0); assert.equal(current(h.document), '');
  } finally { await h.close(); }
  assert.equal(geometry.observed, 0);
});
