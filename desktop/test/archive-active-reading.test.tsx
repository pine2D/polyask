import assert from 'node:assert/strict';
import test from 'node:test';
import { comparisonCopy as copy, comparisonMount } from './ui/comparison-dom';

async function view(h: Awaited<ReturnType<typeof comparisonMount>>, label: string) {
  const button = [...h.document.querySelectorAll<HTMLButtonElement>('.library-view-switch button')].find(node => node.textContent?.startsWith(label));
  assert.equal(!!button, true); await h.click(button!);
}

test('comparison mounts only two active answer readers and does not keep nine hidden original bodies', async () => {
  const h = await comparisonMount(); try {
    assert.equal(h.document.querySelectorAll('.archive-answers').length, 0, 'inactive original bodies are not parsed or mounted');
    assert.equal(h.document.querySelectorAll('.archive-answer-reading').length, 2);
    assert.equal(h.document.querySelectorAll('.archive-synthesis').length, 0);
  } finally { await h.close(); }
});

test('empty analysis mounts no hidden answer bodies and returning to read restores every full saved answer', async () => {
  const h = await comparisonMount(); try {
    await view(h, copy.librarySynthesis);
    assert.equal(h.document.querySelectorAll('.archive-answer-reading').length, 0);
    assert.equal(h.document.querySelectorAll('.archive-compare').length, 0);
    await view(h, copy.libraryRead);
    assert.equal(h.document.querySelectorAll('.archive-answer-reading').length, 3);
    assert.equal(h.document.querySelectorAll('.archive-compare').length, 0);
    assert.equal(h.document.querySelectorAll('.archive-synthesis').length, 0);
  } finally { await h.close(); }
});

test('active surface switching retains comparison choices, differences and both answer scroll positions', async () => {
  const h = await comparisonMount(); try {
    await h.choose(copy.leftAnswer, 'Kimi'); await h.choose(copy.rightAnswer, 'Claude');
    await h.click(h.document.querySelector<HTMLInputElement>('.comparison-filter input')!);
    const columns = () => [...h.document.querySelectorAll<HTMLElement>('.archive-compare-column')];
    await h.scroll(columns()[0], 690); await h.scroll(columns()[1], 810);
    await view(h, copy.libraryRead);
    await h.scroll(h.document.querySelector<HTMLElement>('.archive-detail-pane')!, 380);
    await view(h, copy.libraryCompare);
    assert.equal(columns().map(node => node.querySelector('h3')!.textContent).join(','), 'Kimi,Claude');
    assert.equal(h.document.querySelector<HTMLInputElement>('.comparison-filter input')!.checked, true);
    assert.equal(columns().map(node => node.scrollTop).join(','), '690,810');
    await view(h, copy.libraryRead);
    assert.equal(h.document.querySelector<HTMLElement>('.archive-detail-pane')!.scrollTop, 380);
    assert.equal(h.writes, 0);
  } finally { await h.close(); }
});
