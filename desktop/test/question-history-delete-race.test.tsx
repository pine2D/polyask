import assert from 'node:assert/strict';
import test from 'node:test';
import { act } from 'react';
import { historyMount, copy, q, a2, detail, deferred, waitFor } from './ui/history-dom';
import { questionAnswerFixture } from './question-fixtures';


test('a confirmed delete finishing later must not close a newer question reader', async () => {
  const q2 = { ...q, id: 'question-later', text: 'SECOND QUESTION', sites: ['claude'] as const };
  const a = { ...questionAnswerFixture(q2.id, 1), answerMarkdown: 'SECOND ANSWER' };
  const second = { question: q2, loadedAnswerId: a.id, answers: [a] };
  const removal = deferred<boolean>();
  let calls = 0;
  const h = await historyMount({
    listQuestions: async () => ({ items: [
      { ...q, savedSites: 1, answers: [a2] }, { ...q2, savedSites: 1, answers: [a] }
    ], cursor: null }),
    getQuestion: async (id: string) => id === q2.id ? second : detail(),
    deleteQuestion: () => { calls++; return removal.promise; },
  });
  try {
    await waitFor(() => h.document.querySelectorAll('.question-main').length === 2);
    await h.click(h.document.querySelectorAll<HTMLElement>('.question-main')[0]);
    await h.click(h.button(copy.questionMenu));
    await h.click(h.button(copy.questionDeleteRecord));
    await h.click(h.document.querySelector<HTMLButtonElement>('.confirm-actions .primary')!);
    assert.equal(calls, 1);
    const cancel = [...h.document.querySelectorAll<HTMLButtonElement>('.confirm-actions button')].find(b => b.textContent === copy.cancel)!;
    if (cancel) await h.click(cancel);
    await h.click(h.button(copy.questionBack));
    await h.click(h.document.querySelectorAll<HTMLElement>('.question-main')[1]);
    assert.equal(h.document.querySelector('.markdown-preview')?.textContent?.includes('SECOND ANSWER'), true);
    await h.click(h.button(copy.questionMenu));
    await h.click(h.button(copy.questionDeleteRecord));
    await act(async () => removal.resolve(true));
    assert.equal(h.document.querySelector('.markdown-preview')?.textContent?.includes('SECOND ANSWER'), true,
      'the completed deletion of the previous question must preserve the newer reader');
    assert.equal(h.document.querySelector('.confirm-actions') !== null, true, 'an earlier delete cannot close the later confirmation');
  } finally { await h.close(); }
});
