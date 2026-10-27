import assert from 'node:assert/strict';
import test from 'node:test';
import { comparisonCopy as copy, comparisonMount, comparisonWait } from './ui/comparison-dom';

test('focused saved results share the main toolbar and return without remounting reading columns', async () => {
  const h = await comparisonMount();
  try {
    const column = h.document.querySelector<HTMLElement>('.archive-compare-column')!;
    const toggle = h.document.querySelector<HTMLButtonElement>('.comparison-focus')!;
    await h.scroll(column, 160);
    await h.click(toggle);
    assert.equal(h.document.querySelector('.folder-toolbar .library-organize') !== null, true);
    assert.equal(h.document.querySelectorAll('.library-organize').length, 1);
    assert.equal(h.document.querySelector('.archive-toolbar') === null, true);
    assert.equal(h.document.querySelector('.archive-compare-column') === column, true);
    assert.equal(column.scrollTop, 160);
    const menu = h.document.querySelector<HTMLButtonElement>('.folder-toolbar .library-menu-trigger')!;
    await h.click(menu);
    assert.equal(h.button(copy.exportArchive) !== undefined, true);
    await h.click(h.button(copy.deleteArchive)!);
    assert.equal(h.document.querySelector('.confirm-dialog') !== null, true);
    await h.click(h.button(copy.cancel)!);
    assert.equal(h.document.activeElement === menu, true, 'cancel restores the merged toolbar trigger');
    await h.click(toggle);
    assert.equal(h.document.querySelector('.archive-toolbar .library-organize') !== null, true);
    assert.equal(h.document.querySelectorAll('.library-organize').length, 1);
    assert.equal(h.document.querySelector('.archive-compare-column') === column, true);
    assert.equal(column.scrollTop, 160);
    assert.equal(h.document.activeElement === toggle, true);
  } finally { await h.close(); }
});

test('new decision editing removes saved-result toolbar actions and restores them on cancel', async () => {
  const h = await comparisonMount();
  try {
    await h.click(h.document.querySelector<HTMLButtonElement>('.comparison-focus')!);
    await h.click(h.document.querySelector<HTMLElement>('.archive-record-context > summary')!);
    await h.click(h.button(copy.decisionCreate)!);
    await comparisonWait(() => h.document.querySelector('[name=decision-title]'));
    assert.equal(h.document.querySelector('.folder-toolbar .archive-actions') === null, true);
    await h.click([...h.document.querySelectorAll<HTMLButtonElement>('.decision-detail-actions button')].find(node => node.textContent === copy.decisionCancel)!);
    await h.click(h.document.querySelector<HTMLButtonElement>('.confirm-actions .primary')!);
    assert.equal(h.document.querySelector('.folder-toolbar .library-organize') !== null, true);
    assert.equal(h.document.querySelectorAll('.library-organize').length, 1);
    assert.equal(h.document.activeElement === h.button(copy.decisionCreate), true);
  } finally { await h.close(); }
});

test('ordinary reading keeps one record action group beside its heading and all answers after navigation', async () => {
  const h = await comparisonMount({ startInRead: true });
  try {
    assert.equal(h.document.querySelector('.archive-detail-heading .library-organize') !== null, true);
    assert.equal(h.document.querySelectorAll('.library-organize').length, 1);
    assert.equal(h.document.querySelector('.archive-toolbar') === null, true);
    const answers = [...h.document.querySelectorAll('.archive-answer')];
    await h.click(h.document.querySelector<HTMLAnchorElement>('.archive-answer-nav a:last-child')!);
    assert.equal(h.document.querySelectorAll('.archive-answer').length, 3);
    assert.equal(answers.every(node => node.isConnected), true);
    const menu = h.document.querySelector<HTMLButtonElement>('.archive-detail-heading .library-menu-trigger')!;
    await h.click(menu);
    await h.click(h.button(copy.deleteArchive)!);
    await h.click(h.button(copy.cancel)!);
    assert.equal(h.document.activeElement === menu, true);
    await h.click(h.document.querySelector<HTMLButtonElement>('.library-focus')!);
    assert.equal(h.document.querySelector('.folder-toolbar .library-organize') !== null, true);
    assert.equal(h.document.querySelectorAll('.library-organize').length, 1);
    assert.equal(answers.every(node => node.isConnected), true);
    await h.click(h.document.querySelector<HTMLButtonElement>('.library-focus')!);
    assert.equal(h.document.querySelector('.archive-detail-heading .library-organize') !== null, true);
  } finally { await h.close(); }
});
