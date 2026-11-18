import assert from 'node:assert/strict';
import test from 'node:test';
import { comparisonCopy as copy, comparisonMount, comparisonWait } from './ui/comparison-dom';

test('navigating A to B to A dismisses the old confirmation; confirming B deletes only B', async () => {
  const deleted: string[] = [];
  const h = await comparisonMount({ startInRead: true, api: { deleteArchive: async (id: string) => { deleted.push(id); } } });
  const openDelete = async () => {
    await h.click(h.document.querySelector<HTMLButtonElement>('.archive-actions .library-menu-trigger')!);
    await h.click(h.button(copy.deleteArchive)!);
    assert.equal(h.document.querySelector('.confirm-dialog') !== null, true);
  };
  const navigate = async (id: string, title: string) => {
    await h.navigateTo(id);
    await comparisonWait(() => h.document.querySelector('.archive-detail h1')?.textContent === title);
    assert.equal(h.document.querySelector('.confirm-dialog') === null, true);
  };
  try {
    const titleA = h.document.querySelector('.archive-detail h1')!.textContent!;
    await openDelete();
    await navigate('comparison-B', 'Other saved result');
    await navigate('comparison-A', titleA);
    assert.deepEqual(deleted, []);
    await navigate('comparison-B', 'Other saved result'); await openDelete();
    const confirm = [...h.document.querySelectorAll<HTMLButtonElement>('.confirm-dialog button')]
      .find(node => node.textContent === copy.deleteArchive)!;
    await h.click(confirm);
    assert.deepEqual(deleted, ['comparison-B']);
  } finally { await h.close(); }
});

test('canceling metadata navigation keeps the selected archive and its unsaved note', async () => {
  const h = await comparisonMount(); try {
    await h.input(h.document.querySelector<HTMLTextAreaElement>('[name=archive-note]')!, 'Keep this unsaved note.');
    const other = [...h.document.querySelectorAll<HTMLButtonElement>('[data-action=library-open-item]')]
      .find(node => node.textContent?.includes('Other saved result'))!;
    await h.click(other); await comparisonWait(() => h.document.querySelector('.confirm-dialog'));
    const cancel = [...h.document.querySelectorAll<HTMLButtonElement>('.confirm-dialog button')].find(node => node.textContent === copy.cancel)!;
    await h.click(cancel);
    assert.equal(h.document.querySelector('.archive-detail h1')?.textContent, 'Compare saved answers');
    assert.equal(h.document.querySelector<HTMLTextAreaElement>('[name=archive-note]')!.value, 'Keep this unsaved note.');
  } finally { await h.close(); }
});
