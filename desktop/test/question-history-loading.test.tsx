import test from 'node:test';
import assert from 'node:assert/strict';
import { act } from 'react';
import { a1, a2, b, copy, deferred, detail, historyMount, waitFor } from './ui/history-dom';
import type { QuestionDetail } from '../src/shared/question-history';

test('initial loading, missing and failure have distinct detail surfaces and targeted retry', async () => {
  const reads = [deferred<QuestionDetail | null>(), deferred<QuestionDetail | null>()]; let calls = 0;
  const h = await historyMount({ getQuestion: () => reads[calls++].promise });
  try {
    await waitFor(() => h.document.querySelector('.question-main')); await h.click(h.document.querySelector<HTMLElement>('.question-main')!);
    assert.ok(h.document.querySelector('.question-detail-state [role="status"]'), 'initial detail must enter explicit loading immediately');
    await act(async () => reads[0].reject(new Error('service_failure')));
    assert.ok(h.document.querySelector('.question-detail-state [role="alert"]'), 'failure has its own detail retry');
    await h.click(h.button(copy.questionRetry)); assert.equal(calls, 2);
    await act(async () => reads[1].resolve(null));
    assert.ok(h.document.querySelector('.question-detail-state [data-state="missing"]'), 'deleted/unavailable record differs from request failure');
    assert.equal((h.document.querySelector('.question-search')) === (null), true);
  } finally { await h.close(); }
});

test('switching saved attempts shows target loading, rejects late replies and retries the same target', async () => {
  const pending: { id: string; task: ReturnType<typeof deferred<QuestionDetail>> }[] = [];
  const h = await historyMount({ getQuestion: (_q: string, id?: string) => {
    if (!id) return Promise.resolve(detail()); const task = deferred<QuestionDetail>(); pending.push({ id, task }); return task.promise;
  } });
  try {
    await waitFor(() => h.document.querySelector('.question-main')); await h.click(h.document.querySelector<HTMLElement>('.question-main')!);
    await h.select(h.document.querySelector('select')!, a1.id);
    await h.click(h.button('Kimi'));
    assert.ok(h.document.querySelector('.question-answer [role="status"]'), 'requested body is loading, not missing');
    assert.equal(h.button(copy.questionCopy).disabled, true); assert.ok(!h.document.querySelector('.markdown-preview'));
    await h.click(h.button('Claude'));
    assert.equal((h.document.querySelector('select') as HTMLSelectElement).value, a1.id, 'site returns to its chosen old attempt');
    await h.select(h.document.querySelector('select')!, a2.id);
    await act(async () => pending[1].task.resolve(detail(b.id)));
    assert.equal((h.document.querySelector('.markdown-preview')) === (null), true, 'old Kimi reply cannot appear under Claude');
    await act(async () => pending.at(-1)!.task.reject(new Error('io_failed')));
    assert.ok(h.document.querySelector('.question-answer [role="alert"]'));
    await h.click(h.button(copy.questionRetry)); assert.equal(pending.at(-1)!.id, a2.id);
    await act(async () => pending.at(-1)!.task.resolve(detail(a2.id)));
    assert.match(h.document.querySelector('.markdown-preview')!.textContent!, /LATEST CLAUDE BODY/);
    await act(async () => pending[0].task.resolve(detail(a1.id)));
    assert.match(h.document.querySelector('.markdown-preview')!.textContent!, /LATEST CLAUDE BODY/);
  } finally { await h.close(); }
});

test('each answer restores its own reading position across site changes', async () => {
  const h = await historyMount();
  try {
    await waitFor(() => h.document.querySelector('.question-main')); await h.click(h.document.querySelector<HTMLElement>('.question-main')!);
    const reader = h.document.querySelector<HTMLElement>('.question-reader')!;
    reader.scrollTop = 173;
    await h.click(h.button('Kimi')); reader.scrollTop = 91;
    await h.click(h.button('Claude'));
    assert.equal(reader.scrollTop, 173, 'switching back restores the answer position');
    await h.click(h.button('Kimi')); assert.equal(reader.scrollTop, 91);
  } finally { await h.close(); }
});
