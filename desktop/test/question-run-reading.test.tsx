import assert from 'node:assert/strict';
import test from 'node:test';
import { act } from 'react';
import { a1, a2, b, deferred, detail, historyMount, q, waitFor } from './ui/history-dom';
import type { QuestionDetail } from '../src/shared/question-history';

test('a progress request opens the exact stored question and attempt without navigating or collecting a site', async () => {
  const calls: string[] = [], live: string[] = [];
  const h = await historyMount({ getQuestion: async (id: string, answerId?: string) => { calls.push(`${id}:${answerId}`); return detail(answerId); },
    restoreQuestion: async () => { live.push('restore'); }, collect: async () => { live.push('collect'); }, broadcast: async () => { live.push('broadcast'); }
  }, { openRequest: { request: 1, questionId: q.id, answerId: b.id } });
  try {
    await act(async () => undefined);
    assert.deepEqual(calls, [`${q.id}:${b.id}`]); assert.equal(h.document.querySelector('.markdown-preview')?.textContent?.includes('KIMI BODY'), true);
    assert.deepEqual(live, []);
    await h.rerender({ openRequest: { request: 2, questionId: q.id, answerId: a1.id } });
    assert.equal(calls.at(-1), `${q.id}:${a1.id}`);
    assert.equal(h.document.querySelector('.markdown-preview')?.textContent?.includes('OLD CLAUDE BODY'), true);
  } finally { await h.close(); }
});
test('a newer progress reading intention owns the body after out-of-order database replies', async () => {
  const pending = [deferred<QuestionDetail>(), deferred<QuestionDetail>()]; let n = 0;
  const h = await historyMount({ getQuestion: () => pending[n++].promise }, { openRequest: { request: 1, questionId: q.id, answerId: a1.id } });
  try {
    assert.equal(n, 1);
    await h.rerender({ openRequest: { request: 2, questionId: q.id, answerId: a2.id } }); assert.equal(n, 2);
    await act(async () => pending[1].resolve(detail(a2.id)));
    await waitFor(() => h.document.querySelector('.markdown-preview'));
    await act(async () => pending[0].resolve(detail(a1.id)));
    assert.equal(h.document.querySelector('.markdown-preview')?.textContent?.includes('LATEST CLAUDE BODY'), true);
  } finally { await h.close(); }
});
test('guide reading acknowledges only the current displayed nonempty exact stored copy', async () => {
  const older = deferred<QuestionDetail>(), newer = deferred<QuestionDetail>();
  const acknowledgements: string[] = [];
  const h = await historyMount({ getQuestion: (_id: string, answerId?: string) => answerId === b.id ? newer.promise : older.promise }, {
    openRequest: { request: 1, questionId: q.id, answerId: a1.id, source: 'guide' },
    onReadAccepted: (id: string, request: number) => acknowledgements.push(`${id}:${request}`)
  }, { strictMode: true });
  try {
    await h.rerender({ openRequest: { request: 2, questionId: q.id, answerId: b.id, source: 'guide' } });
    assert.deepEqual(acknowledgements, []);
    await act(async () => newer.resolve(detail(b.id)));
    assert.equal(h.document.querySelector('.markdown-preview')?.textContent?.includes('KIMI BODY'), true);
    assert.deepEqual(acknowledgements, [`${q.id}:2`]);
    await act(async () => older.resolve(detail(a1.id)));
    assert.deepEqual(acknowledgements, [`${q.id}:2`]);
  } finally { await h.close(); }
});
test('empty, failed and mismatched stored reads never complete the guide', async () => {
  for (const result of ['empty', 'failed', 'mismatched'] as const) {
    let acknowledgements = 0;
    const h = await historyMount({ getQuestion: async () => {
      if (result === 'failed') throw new Error('synthetic');
      if (result === 'mismatched') return detail(a1.id);
      return { ...detail(b.id), answers: detail(b.id).answers.map(a => ({ ...a, answerMarkdown: a.id === b.id ? '  ' : null })) };
    } }, { openRequest: { request: 1, questionId: q.id, answerId: b.id, source: 'guide' }, onReadAccepted: () => { acknowledgements++; } });
    try { await act(async () => undefined); assert.equal(acknowledgements, 0, result); }
    finally { await h.close(); }
  }
});
test('a guide compare invitation opens explicit choice of two complete stored copies and never saves on entry', async () => {
  let writes = 0; const acknowledgements: string[] = [];
  const h = await historyMount({ getQuestion: async (_id: string, answerId?: string) => detail(answerId),
    createQuestionArchive: async () => { writes++; throw new Error('unexpected'); }
  }, { openRequest: { request: 7, questionId: q.id, answerId: a2.id, source: 'guide', mode: 'compare', answerIds: [a2.id, b.id] },
    onReadAccepted: (id: string, request: number) => acknowledgements.push(`${id}:${request}`) });
  try {
    await act(async () => undefined);
    assert.equal(h.document.querySelector('.question-archive-picker') !== null, true);
    const selected = [...h.document.querySelectorAll<HTMLSelectElement>('.question-archive-picker select')].map(node => node.value).filter(Boolean);
    assert.deepEqual(selected, [a2.id, b.id]); assert.equal(writes, 0); assert.deepEqual(acknowledgements, []);
  } finally { await h.close(); }
});
