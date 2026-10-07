import assert from 'node:assert/strict';
import test from 'node:test';
import { comparisonCopy as copy, comparisonMount, comparisonRecord, comparisonWait } from './ui/comparison-dom';

async function view(h: Awaited<ReturnType<typeof comparisonMount>>, index: number) {
  await h.click(h.document.querySelector<HTMLButtonElement>(`.library-view-switch button:nth-child(${index})`)!);
}
const columns = (h: Awaited<ReturnType<typeof comparisonMount>>) => [...h.document.querySelectorAll<HTMLElement>('.archive-compare-column')];

test('a changed body while comparison is inactive resets only its saved column position on return', async () => {
  const h = await comparisonMount(); try {
    await h.scroll(columns(h)[0], 690); await h.scroll(columns(h)[1], 810); await view(h, 1);
    h.replace({ ...comparisonRecord, updatedAt: 101, results: comparisonRecord.results.map((result, index) =>
      index === 0 ? { ...result, text: result.text + '\n\nChanged source text.' } : result) });
    await h.click(h.document.querySelector<HTMLButtonElement>('.archive-detail-actions button')!);
    await comparisonWait(() => h.document.querySelector('.archive-status')?.textContent?.includes(copy.librarySaved));
    await view(h, 2);
    assert.equal(columns(h)[0].scrollTop, 0, 'changed source cannot reuse the previous body position');
    assert.equal(columns(h)[1].scrollTop, 810, 'unchanged source retains its independent position');
  } finally { await h.close(); }
});

test('a refreshed record with fewer than two available sources falls back to its complete original reading', async () => {
  const h = await comparisonMount(); try {
    h.replace({ ...comparisonRecord, updatedAt: 101, results: comparisonRecord.results.slice(0, 1) });
    await h.click(h.document.querySelector<HTMLButtonElement>('.archive-detail-actions button')!);
    await comparisonWait(() => h.document.querySelector('.archive-status')?.textContent?.includes(copy.librarySaved));
    assert.equal(h.document.querySelector('.archive-detail')?.getAttribute('data-view'), 'read');
    assert.equal(h.document.querySelectorAll('.archive-answer-reading').length, 1);
    assert.equal(h.document.querySelectorAll('.archive-compare').length, 0);
  } finally { await h.close(); }
});

test('selecting a different saved record clears comparison choices rather than reusing the previous record positions', async () => {
  const h = await comparisonMount(); try {
    await h.choose(copy.leftAnswer, 'Kimi'); await h.click(h.document.querySelector<HTMLInputElement>('.comparison-filter input')!);
    await h.scroll(columns(h)[0], 690);
    const other = [...h.document.querySelectorAll<HTMLButtonElement>('[data-action=library-open-item]')]
      .find(node => node.textContent?.includes('Other saved result'))!;
    await h.click(other); await view(h, 2);
    assert.equal(columns(h).map(node => node.querySelector('h3')!.textContent).join(','), 'Claude,ChatGPT');
    assert.equal(h.document.querySelector<HTMLInputElement>('.comparison-filter input')!.checked, false);
    assert.equal(columns(h).map(node => node.scrollTop).join(','), '0,0');
  } finally { await h.close(); }
});
