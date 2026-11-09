import assert from 'node:assert/strict';
import test from 'node:test';
import { act } from 'react';
import { copy, historyMount, waitFor, q, a1, a2, b, deferred } from './ui/history-dom';
import type { QuestionRecord } from '../src/shared/question-history';

test('history saves once, keeps the current state until acknowledgement and retries failures in place', async () => {
  let calls = 0, pending = deferred<QuestionRecord>();
  const h = await historyMount({ setQuestionFavorite: () => { calls++; return pending.promise; } });
  try {
    await waitFor(() => h.document.querySelector('.question-list [data-star-button]'));
    const star = h.document.querySelector<HTMLButtonElement>('.question-list [data-star-button]')!;
    await act(async () => star.focus());
    await h.click(star); await h.click(star);
    assert.equal(calls, 1); assert.equal(star.getAttribute('aria-pressed'), 'false');
    assert.equal(star.getAttribute('aria-busy'), 'true'); assert.equal(h.document.activeElement === star, true);
    assert.equal(h.document.querySelector('.question-reader') === null, true);
    await act(async () => pending.reject(new Error('save failed')));
    assert.equal(star.getAttribute('aria-pressed'), 'false');
    assert.equal(h.document.querySelector('[role=alert]')?.textContent, copy.starSaveFailed);
    pending = deferred(); await h.click(star);
    await act(async () => pending.resolve({ ...q, schema: 7, favorite: true, updatedAt: 20 }));
    assert.equal(calls, 2); assert.equal(star.getAttribute('aria-pressed'), 'true');
    assert.equal(h.document.activeElement === star, true);
    await h.click(h.document.querySelector<HTMLElement>('.question-main')!);
    assert.equal(h.document.querySelector('.question-reader [data-star-button]')?.getAttribute('aria-pressed'), 'true', 'older detail replies cannot remove an acknowledged star');
  } finally { await h.close(); }
});

test('starred filter reaches the repository, removes an unstarred row and preserves its open reader', async () => {
  let record: QuestionRecord = { ...q, schema: 7, favorite: true, updatedAt: 20 };
  const queries: boolean[] = [];
  const h = await historyMount({
    listQuestions: async (filters: any) => {
      queries.push(!!filters.favorite);
      return { items: filters.favorite && !record.favorite ? [] : [{ ...record, savedSites: 2, answers: [a1, a2, b] }], cursor: null };
    },
    getQuestion: async () => ({ question: record, loadedAnswerId: a2.id, answers: [a1, a2, b] }),
    setQuestionFavorite: async (_id: string, favorite: boolean) => (record = { ...record, favorite, updatedAt: record.updatedAt + 1 }),
  });
  try {
    await waitFor(() => h.document.querySelector('.question-main'));
    await h.click(h.document.querySelector<HTMLElement>('[data-star-filter]')!);
    await waitFor(() => queries.includes(true) && h.document.querySelector('.question-main'));
    await h.click(h.document.querySelector<HTMLElement>('.question-main')!);
    const reader = h.document.querySelector<HTMLElement>('.question-reader')!;
    reader.scrollTop = 150;
    await h.click(h.document.querySelector<HTMLElement>('.question-reader [data-star-button]')!);
    assert.equal(h.document.querySelector('.question-reader') === reader, true);
    assert.equal(reader.scrollTop, 150);
    assert.equal(h.document.querySelector('.question-main') === null, true);
    assert.equal(reader.querySelector('[data-star-button]')?.getAttribute('aria-pressed'), 'false');
  } finally { await h.close(); }
});

test('late star acknowledgement after closing cannot replace the next session', async () => {
  const pending = deferred<QuestionRecord>();
  const h = await historyMount({ setQuestionFavorite: () => pending.promise });
  try {
    await waitFor(() => h.document.querySelector('.question-main'));
    await h.click(h.document.querySelector<HTMLElement>('.question-list [data-star-button]')!);
    await h.rerender({ open: false }); await h.rerender({ open: true });
    await act(async () => pending.resolve({ ...q, schema: 7, favorite: true, updatedAt: 20 }));
    await waitFor(() => h.document.querySelector('.question-main'));
    assert.equal(h.document.querySelector('.question-list [data-star-button]')?.getAttribute('aria-pressed'), 'false');
  } finally { await h.close(); }
});

test('out-of-order row and reader acknowledgements preserve the newest explicit choice', async () => {
  const writes = [deferred<QuestionRecord>(), deferred<QuestionRecord>(), deferred<QuestionRecord>()];
  let calls = 0;
  const h = await historyMount({ setQuestionFavorite: () => writes[calls++].promise });
  try {
    await waitFor(() => h.document.querySelector('.question-main'));
    await h.click(h.document.querySelector<HTMLElement>('.question-main')!);
    await h.click(h.document.querySelector<HTMLElement>('.question-list [data-star-button]')!);
    const detail = () => h.document.querySelector<HTMLElement>('.question-reader [data-star-button]')!;
    await h.click(detail());
    await act(async () => writes[1].resolve({ ...q, schema: 7, favorite: true, updatedAt: 30 }));
    await h.click(detail());
    await act(async () => writes[2].resolve({ ...q, schema: 7, favorite: false, updatedAt: 31 }));
    await act(async () => writes[0].resolve({ ...q, schema: 7, favorite: true, updatedAt: 20 }));
    assert.equal(calls, 3);
    assert.equal(detail().getAttribute('aria-pressed'), 'false');
    assert.equal(h.document.querySelector('.question-list [data-star-button]')?.getAttribute('aria-pressed'), 'false');
  } finally { await h.close(); }
});
