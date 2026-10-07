import assert from 'node:assert/strict';
import test from 'node:test';
import { comparisonCopy as copy, comparisonMount, comparisonWait } from './ui/comparison-dom';

test('entry acknowledgment comes from the loaded active comparison and reports actual read changes once', async () => {
  const entries: string[] = [];
  const h = await comparisonMount({ onArchiveEntered: (id, mode) => entries.push(`${id}:${mode}`) }); try {
    assert.equal(entries.join(','), 'comparison-A:compare', 'StrictMode has one real loaded comparison acknowledgment');
    await h.choose(copy.leftAnswer, 'Kimi'); assert.equal(entries.length, 1);
    await h.click(h.document.querySelector<HTMLButtonElement>('.library-view-switch button:first-child')!);
    assert.equal(entries.join(','), 'comparison-A:compare,comparison-A:read');
    await h.click(h.button(copy.synthesisAction)!); await comparisonWait(() => h.document.querySelector('.synthesis-workspace'));
    assert.equal(entries.length, 2, 'an overriding editor is not an active archive reader');
  } finally { await h.close(); }
});

test('canceled dirty metadata navigation cannot acknowledge another queued or unmounted archive', async () => {
  const entries: string[] = [];
  const h = await comparisonMount({ onArchiveEntered: (id, mode) => entries.push(`${id}:${mode}`) }); try {
    await h.input(h.document.querySelector<HTMLTextAreaElement>('[name=archive-note]')!, 'Keep this unsaved note.');
    const other = [...h.document.querySelectorAll<HTMLButtonElement>('[data-action=library-open-item]')]
      .find(node => node.textContent?.includes('Other saved result'))!;
    await h.click(other); await comparisonWait(() => h.document.querySelector('.confirm-dialog'));
    const cancel = [...h.document.querySelectorAll<HTMLButtonElement>('.confirm-dialog button')].find(node => node.textContent === copy.cancel)!;
    await h.click(cancel);
    assert.equal(entries.join(','), 'comparison-A:compare');
    assert.equal(h.document.querySelector('.archive-detail h1')?.textContent, 'Compare saved answers');
    assert.equal(h.document.querySelector<HTMLTextAreaElement>('[name=archive-note]')!.value, 'Keep this unsaved note.');
  } finally { await h.close(); }
  assert.equal(entries.join(','), 'comparison-A:compare', 'cleanup does not acknowledge a departed surface');
});
