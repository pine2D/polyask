import assert from 'node:assert/strict';
import test from 'node:test';
import { act } from 'react';
import { a1, a2, b, copy, deferred, detail, historyMount, waitFor } from './ui/history-dom';
import type { QuestionDetail } from '../src/shared/question-history';

test('an explicit body request without matching loaded identity never becomes a missing-copy claim', async () => {
  for (const returnedId of [a2.id, undefined]) {
    const h = await historyMount({ getQuestion: async (_q: string, answerId?: string) => answerId
      ? { ...detail(a2.id), loadedAnswerId: returnedId } : detail() });
    try {
      await waitFor(() => h.document.querySelector('.question-main'));
      await h.click(h.document.querySelector<HTMLElement>('.question-main')!); await h.click(h.button('Kimi'));
      assert.equal(h.document.querySelector('.markdown-preview') === null, true);
      assert.equal(h.document.querySelector('.question-answer [data-state="missing"]') !== null, true,
        'unidentified response cannot claim the requested attempt has no saved body');
      assert.equal(h.document.querySelector('.question-answer')!.textContent!.includes(copy.questionNoAnswer), false);
      assert.equal(h.button(copy.questionCopy).disabled, true);
    } finally { await h.close(); }
  }
});

test('a site with no saved attempts shows the real empty state without an endless body loader', async () => {
  const h = await historyMount({ getQuestion: async () => ({ ...detail(), answers: detail().answers.filter(answer => answer.site !== 'kimi') }) });
  try {
    await waitFor(() => h.document.querySelector('.question-main'));
    await h.click(h.document.querySelector<HTMLElement>('.question-main')!); await h.click(h.button('Kimi'));
    assert.equal(h.document.querySelector('.question-answer')!.textContent!.includes(copy.questionNoAnswer), true);
    assert.equal(h.document.querySelector('.question-answer')!.textContent!.includes(copy.questionAnswerLoading), false);
    assert.equal(h.button(copy.questionCopy).disabled, true);
  } finally { await h.close(); }
});

test('back and reopen restore active site, its selected old attempt and its reading position', async () => {
  const requested: (string | undefined)[] = [];
  const h = await historyMount({ getQuestion: async (_q: string, id?: string) => { requested.push(id); return detail(id); } });
  try {
    await waitFor(() => h.document.querySelector('.question-main'));
    await h.click(h.document.querySelector<HTMLElement>('.question-main')!);
    await h.select(h.document.querySelector('select')!, a1.id);
    h.document.querySelector<HTMLElement>('.question-reader')!.scrollTop = 147;
    await h.click(h.button('Kimi')); await h.click(h.button('Claude'));
    await h.click(h.button(copy.questionBack)); await h.click(h.document.querySelector<HTMLElement>('.question-main')!);
    assert.equal(requested.at(-1), a1.id);
    assert.equal((h.document.querySelector('select') as HTMLSelectElement).value, a1.id);
    assert.equal(h.document.querySelector<HTMLElement>('.question-reader')!.scrollTop, 147);
    assert.equal(h.document.querySelector('.markdown-preview')!.textContent!.includes('OLD CLAUDE BODY'), true);
    assert.equal(h.document.querySelector('.markdown-preview')!.textContent!.includes(b.answerMarkdown), false);
  } finally { await h.close(); }
});

test('reopening after a remembered attempt disappears resolves the latest existing attempt on that site', async () => {
  let disappeared = false;
  const h = await historyMount({ getQuestion: async (_q: string, id?: string) => {
    if (disappeared && id === a1.id) throw new Error('history_not_found');
    const value = detail(id);
    return disappeared ? { ...value, answers: value.answers.filter(answer => answer.id !== a1.id) } : value;
  } });
  try {
    await waitFor(() => h.document.querySelector('.question-main'));
    await h.click(h.document.querySelector<HTMLElement>('.question-main')!);
    await h.select(h.document.querySelector('select')!, a1.id);
    await h.click(h.button(copy.questionBack)); disappeared = true;
    await h.click(h.document.querySelector<HTMLElement>('.question-main')!);
    assert.equal(h.document.querySelector('.markdown-preview')?.textContent?.includes('LATEST CLAUDE BODY') ?? false, true,
      'an obsolete remembered attempt must not block available saved history');
    assert.equal(h.document.querySelector<HTMLSelectElement>('select')?.value, a2.id);
  } finally { await h.close(); }
});

test('a nondefault-site fallback loads its own body and ignores its reply after leaving detail', async () => {
  let disappeared = false;
  const next = { ...b, id: `${b.id}-new`, attempt: 2, answerMarkdown: 'NEW KIMI BODY' };
  const body = deferred<QuestionDetail>();
  const h = await historyMount({ getQuestion: async (_q: string, id?: string) => {
    if (disappeared && id === b.id) throw new Error('history_not_found');
    if (disappeared && id === next.id) return body.promise;
    const value = detail(id);
    return disappeared ? { ...value, answers: [...value.answers.filter(answer => answer.id !== b.id), { ...next, answerMarkdown: null }] } : value;
  } });
  try {
    await waitFor(() => h.document.querySelector('.question-main'));
    await h.click(h.document.querySelector<HTMLElement>('.question-main')!); await h.click(h.button('Kimi'));
    await h.click(h.button(copy.questionBack)); disappeared = true;
    await h.click(h.document.querySelector<HTMLElement>('.question-main')!);
    assert.equal(h.document.querySelector<HTMLSelectElement>('select')?.value, next.id);
    assert.equal(h.document.querySelector('.markdown-preview') === null, true, 'default-site body cannot appear under the fallback site');
    assert.equal(h.button(copy.questionCopy).disabled, true);
    await h.click(h.button(copy.questionBack));
    await act(async () => body.resolve({ question: detail().question, loadedAnswerId: next.id, answers: [a1, a2, next] }));
    assert.equal(h.document.querySelector('.question-main') !== null, true);
    assert.equal(h.document.querySelector('.question-reader') === null, true);
  } finally { await h.close(); }
});
