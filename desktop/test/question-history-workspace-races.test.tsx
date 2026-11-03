import assert from 'node:assert/strict';
import test from 'node:test';
import { act } from 'react';
import { historyMount, copy, q, a2, detail, deferred, waitFor } from './ui/history-dom';
import type { QuestionDetail } from '../src/shared/question-history';

const other = { ...q, id: 'other-question', text: 'OTHER QUESTION' };
const list = () => ({ items: [q, other].map(question => ({ ...question, savedSites: 1, answers: [{ ...a2, conversationUrl: 'https://example.com/synthetic-conversation' }] })), cursor: null });

for (const target of ['other', 'current'] as const) test(`deleting ${target} during an initial read settles the right reader`, async () => {
  const pending = deferred<QuestionDetail>(), removal = deferred<boolean>();
  const h = await historyMount({ listQuestions: async () => list(), getQuestion: () => pending.promise, deleteQuestion: () => removal.promise });
  try {
    await waitFor(() => h.document.querySelectorAll('.question-main').length === 2);
    await h.click(h.document.querySelector<HTMLElement>('.question-main')!);
    const row = h.document.querySelector(`[data-question-id="${target === 'current' ? q.id : other.id}"]`)!;
    await h.click([...row.querySelectorAll<HTMLButtonElement>('.question-menu button')].find(button => button.textContent === copy.questionDelete)!);
    await h.click(h.document.querySelector<HTMLButtonElement>('.confirm-actions .primary')!);
    await act(async () => removal.resolve(true));
    await act(async () => pending.resolve(detail()));
    assert.equal(h.document.querySelector('.question-detail-state [data-state="loading"]') === null, true, 'no orphaned loading state');
    assert.equal(!!h.document.querySelector('.markdown-preview'), target === 'other', 'only deletion of the active record closes its reader');
  } finally { await h.close(); }
});

for (const outcome of ['cancel', 'preview-fail', 'execute-fail'] as const) test(`restoring another record with ${outcome} preserves the current in-flight read`, async () => {
  const pending = deferred<QuestionDetail>(); let previews = 0;
  const h = await historyMount({ listQuestions: async () => list(), getQuestion: () => pending.promise,
    previewQuestion: async () => { previews++; if (outcome === 'preview-fail') throw Error('preview_failed'); return { token: 'synthetic', affected: ['claude'], needsConfirmation: true }; },
    restoreQuestion: async () => { throw Error('restore_failed'); } });
  try {
    await waitFor(() => h.document.querySelectorAll('.question-main').length === 2);
    await h.click(h.document.querySelector<HTMLElement>('.question-main')!);
    await h.click(h.document.querySelector<HTMLElement>(`[data-question-id="${other.id}"] .question-restore`)!);
    assert.equal(previews, 1, 'the restore action actually reaches its preview');
    if (outcome !== 'preview-fail') {
      const buttons = [...h.document.querySelectorAll<HTMLButtonElement>('.confirm-actions button')];
      await h.click(outcome === 'cancel' ? buttons.find(button => button.textContent === copy.cancel)! : h.document.querySelector<HTMLButtonElement>('.confirm-actions .primary')!);
    }
    await act(async () => pending.resolve(detail()));
    assert.equal(h.document.querySelector('.markdown-preview')?.textContent?.includes('LATEST CLAUDE BODY'), true);
    assert.equal(h.document.querySelector('.question-detail-state') === null, true);
  } finally { await h.close(); }
});

test('opening a reader closes a list menu before that list can become hidden', async () => {
  const h = await historyMount();
  try {
    await waitFor(() => h.document.querySelector('.question-main'));
    const menu = h.document.querySelector<HTMLDetailsElement>('.question-menu')!;
    await act(async () => { menu.open = true; });
    await h.click(h.document.querySelector<HTMLElement>('.question-main')!);
    assert.equal(menu.open, false, 'a hidden list menu cannot consume the reader Escape');
    await act(async () => h.window.dispatchEvent(new h.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    assert.equal(h.document.querySelector('.question-reader') === null, true);
  } finally { await h.close(); }
});
