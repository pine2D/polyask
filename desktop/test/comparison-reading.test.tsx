import assert from 'node:assert/strict';
import test from 'node:test';
import { comparisonCopy as copy, comparisonMount, comparisonRecord, comparisonWait } from './ui/comparison-dom';
import { createLibrarySessionStore } from '../src/renderer/library-session';

test('reopening a comparison respects the browsing layout saved after returning from expansion', async () => {
  const session = createLibrarySessionStore();
  const first = await comparisonMount({ detailWidth: 700, session });
  try {
    await first.choose(copy.leftAnswer, 'Kimi');
    await first.click(first.button('Return to browsing')!);
  } finally { await first.close(); }
  const restored = await comparisonMount({ detailWidth: 700, session });
  try {
    assert.equal(restored.document.querySelector('.folder-workspace')!.getAttribute('data-focused'), 'false');
    assert.equal(restored.document.querySelector('.archive-compare-column h3')!.textContent, 'Kimi');
    assert.equal(restored.writes, 0);
  } finally { await restored.close(); }
});

test('entering comparison at the stacking breakpoint expands once and returning does not reopen it', async () => {
  for (const [detailWidth, expected] of [[760, 'true'], [760.5, 'false'], [761, 'false']] as const) {
    const h = await comparisonMount({ detailWidth });
    try {
      assert.equal(h.document.querySelector('.folder-workspace')!.getAttribute('data-focused'), expected);
      if (expected === 'true') {
        await h.click(h.button('Return to browsing')!);
        assert.equal(h.document.querySelector('.folder-workspace')!.getAttribute('data-focused'), 'false');
        await h.choose(copy.leftAnswer, 'Kimi');
        assert.equal(h.document.querySelector('.folder-workspace')!.getAttribute('data-focused'), 'false', 'reading updates do not force expansion again');
      }
      assert.equal(h.writes, 0);
    } finally { await h.close(); }
  }
});

test('leaving supplementary analysis restores a comparison without expanding a second time', async () => {
  const h = await comparisonMount({ detailWidth: 700 });
  try {
    await h.click(h.button('Return to browsing')!);
    await h.click(h.button(copy.synthesisAction)!);
    await comparisonWait(() => h.document.querySelector('.synthesis-workspace'));
    await h.click(h.button(copy.synthesisCancel)!);
    await comparisonWait(() => h.document.querySelector('.archive-compare'));
    assert.equal(h.document.querySelector('.folder-workspace')!.getAttribute('data-focused'), 'false');
    assert.equal(h.writes, 0);
  } finally { await h.close(); }
});

test('narrow comparison entry preserves browsing position and waits for unsaved metadata confirmation', async () => {
  const h = await comparisonMount({ detailWidth: 700, startInRead: true });
  try {
    const list = h.document.querySelector<HTMLElement>('.folder-content-list .archive-list')!;
    const detail = h.document.querySelector<HTMLElement>('.archive-detail-pane')!;
    await h.scroll(list, 440); await h.scroll(detail, 320);
    await h.input(h.document.querySelector<HTMLTextAreaElement>('[name=archive-note]')!, 'Keep this unsaved note.');
    await h.click(h.button(copy.libraryCompare)!);
    assert.equal(!!h.document.querySelector('.confirm-dialog'), true);
    assert.equal(h.document.querySelector('.folder-workspace')!.getAttribute('data-focused'), 'false');
    await h.click([...h.document.querySelectorAll<HTMLButtonElement>('.confirm-dialog button')].find(node => node.textContent === copy.cancel)!);
    assert.equal(h.document.querySelector('.archive-detail')!.getAttribute('data-view'), 'read');
    await h.input(h.document.querySelector<HTMLTextAreaElement>('[name=archive-note]')!, '');
    await h.click(h.button(copy.libraryCompare)!);
    assert.equal(h.document.querySelector('.folder-workspace')!.getAttribute('data-focused'), 'true');
    await h.choose(copy.leftAnswer, 'Kimi');
    await h.click(h.button('Return to browsing')!);
    assert.equal(list.scrollTop, 440); assert.equal(detail.scrollTop, 320);
    assert.equal(h.document.querySelector('.archive-compare-column h3')!.textContent, 'Kimi');
    assert.equal(h.writes, 0);
  } finally { await h.close(); }
});

test('expanding comparison restores browsing and both answers without resetting choices or filtering', async () => {
  const h = await comparisonMount();
  try {
    await h.choose(copy.leftAnswer, 'Kimi'); await h.choose(copy.rightAnswer, 'Claude');
    await h.click(h.document.querySelector<HTMLInputElement>('.comparison-filter input')!);
    const list = h.document.querySelector<HTMLElement>('.folder-content-list .archive-list')!;
    const detail = h.document.querySelector<HTMLElement>('.archive-detail-pane')!;
    const columns = () => [...h.document.querySelectorAll<HTMLElement>('.archive-compare-column')];
    await h.scroll(list, 440); await h.scroll(detail, 320); await h.scroll(columns()[0], 690); await h.scroll(columns()[1], 810);
    const expand = h.button('Expand comparison');
    assert.equal(!!expand, true, 'comparison has a direct expand action');
    await h.click(expand!);
    assert.equal(h.document.querySelector('.folder-workspace')!.getAttribute('data-focused'), 'true');
    assert.equal(h.document.querySelectorAll('.archive-compare').length, 1);
    assert.equal(h.document.querySelector<HTMLInputElement>('.comparison-filter input')!.checked, true);
    assert.equal(columns().map(node => node.querySelector('h3')!.textContent).join(','), 'Kimi,Claude');
    await h.scroll(columns()[0], 710); await h.scroll(columns()[1], 830);
    const back = h.button('Return to browsing'); assert.equal(!!back, true, 'expanded comparison has an explicit return');
    await h.click(back!);
    assert.equal(h.document.querySelector('.folder-workspace')!.getAttribute('data-focused'), 'false');
    assert.equal(list.scrollTop, 440); assert.equal(detail.scrollTop, 320);
    assert.equal(columns().map(node => node.scrollTop).join(','), '710,830');
    assert.equal(h.document.querySelector('.folder-content-list [aria-current=true] .library-item-title')!.textContent, comparisonRecord.task);
    assert.equal(h.document.activeElement === h.button('Expand comparison'), true);
    assert.equal(h.writes, 0, 'reading transitions have no data writes');
  } finally { await h.close(); }
});

test('switching a comparison side restores each saved answer position and starts a new answer at its own position', async () => {
  const h = await comparisonMount();
  try {
    const columns = () => [...h.document.querySelectorAll<HTMLElement>('.archive-compare-column')];
    await h.scroll(columns()[0], 460); await h.scroll(columns()[1], 900);
    await h.choose(copy.leftAnswer, 'Kimi');
    assert.equal(columns()[0].scrollTop, 0, 'another source does not inherit the previous answer scroll');
    await h.scroll(columns()[0], 280); await h.choose(copy.leftAnswer, 'Claude');
    assert.equal(columns()[0].scrollTop, 460); assert.equal(columns()[1].scrollTop, 900);
    await h.choose(copy.leftAnswer, 'Kimi'); assert.equal(columns()[0].scrollTop, 280);
  } finally { await h.close(); }
});

test('a changed saved body resets only its reading position while retaining available choices', async () => {
  const h = await comparisonMount();
  try {
    const columns = () => [...h.document.querySelectorAll<HTMLElement>('.archive-compare-column')];
    await h.scroll(columns()[0], 460); await h.scroll(columns()[1], 900);
    h.replace({ ...comparisonRecord, updatedAt: 101, results: comparisonRecord.results.map((result, index) =>
      index === 0 ? { ...result, text: 'Changed saved Claude body.' } : result) });
    await h.click(h.document.querySelector<HTMLButtonElement>('.archive-detail-actions button')!);
    await comparisonWait(() => columns()[0].textContent?.includes('Changed saved Claude body.'));
    assert.equal(columns()[0].scrollTop, 0, 'the old body scroll cannot be reused for replacement text');
    assert.equal(columns()[1].scrollTop, 900);
    assert.equal(columns().map(node => node.querySelector('h3')!.textContent).join(','), 'Claude,ChatGPT');
  } finally { await h.close(); }
});

test('expansion follows existing unsaved metadata protection and cancel retains the edited note', async () => {
  const h = await comparisonMount();
  try {
    await h.input(h.document.querySelector<HTMLTextAreaElement>('[name=archive-note]')!, 'Keep my unsaved reasoning.');
    const expand = h.button('Expand comparison'); assert.equal(!!expand, true, 'comparison has a direct expand action');
    await h.click(expand!);
    assert.equal(!!h.document.querySelector('.confirm-dialog'), true);
    assert.equal(h.document.querySelector('.folder-workspace')!.getAttribute('data-focused'), 'false');
    const cancel = [...h.document.querySelectorAll<HTMLButtonElement>('.confirm-dialog button')].find(node => node.textContent === copy.cancel)!;
    await h.click(cancel);
    assert.equal(h.document.querySelector<HTMLTextAreaElement>('[name=archive-note]')!.value, 'Keep my unsaved reasoning.');
    assert.equal(h.writes, 0);
  } finally { await h.close(); }
});
