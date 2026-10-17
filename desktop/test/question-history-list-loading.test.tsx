import assert from 'node:assert/strict';
import test from 'node:test';
import { act } from 'react';
import { getCopy } from '../src/shared/copy';
import type { QuestionPage } from '../src/shared/question-history';
import { deferred, historyMount, q } from './ui/history-dom';

// Regressions: claiming an empty library before its first read, or hiding a failed read behind a loader.
for (const populated of [true, false]) {
  test(`first history read stays pending until ${populated ? 'a populated' : 'an empty'} result is known`, async t => {
    for (const locale of ['en', 'zh-CN', 'zh-TW']) {
      const copy = getCopy(locale), read = deferred<QuestionPage>();
      const h = await historyMount({ listQuestions: () => read.promise }, { open: false, copy }, { strictMode: true });
      t.mock.timers.enable({ apis: ['setTimeout'] });
      try {
        await h.rerender({ open: true });
        const state = () => h.document.querySelector('.question-scroll > .question-empty');
        assert.equal(state()?.textContent, copy.questionLoading, 'opening must describe the unread state before the debounce fires');
        assert.equal(h.document.querySelector('.question-scroll')?.getAttribute('aria-busy'), 'true');
        await act(async () => t.mock.timers.tick(200));
        assert.equal(state()?.textContent, copy.questionLoading, 'an unresolved read must not claim the library is empty');
        await act(async () => read.resolve({ items: populated ? [{ ...q, savedSites: 0, answers: [] }] : [], cursor: null }));
        assert.equal(h.document.querySelector('.question-scroll')?.getAttribute('aria-busy'), 'false');
        assert.equal(h.document.querySelectorAll('.question-main').length, populated ? 1 : 0);
        assert.equal(state()?.textContent ?? '', populated ? '' : copy.questionEmpty);
      } finally { await h.close(); t.mock.timers.reset(); }
    }
  });
}

test('an initial history failure exits pending and a successful retry can confirm an empty list', async t => {
  const reads = [deferred<QuestionPage>(), deferred<QuestionPage>()]; let calls = 0;
  const copy = getCopy('en');
  const h = await historyMount({ listQuestions: () => reads[calls++].promise }, { open: false });
  t.mock.timers.enable({ apis: ['setTimeout'] });
  try {
    await h.rerender({ open: true });
    assert.equal(h.document.querySelector('.question-scroll > .question-empty')?.textContent, copy.questionLoading);
    await act(async () => t.mock.timers.tick(200));
    await act(async () => reads[0].reject(new Error('read_failed')));
    assert.equal(h.document.querySelector('.question-scroll')?.getAttribute('aria-busy'), 'false');
    assert.equal(h.document.querySelector('[role="alert"]')?.textContent?.includes(copy.questionLoadFailed), true);
    assert.equal(h.document.querySelector('.question-scroll > .question-empty') === null, true, 'failure is neither loading nor an empty result');
    await h.click(h.button(copy.questionRetry));
    assert.equal(h.document.querySelector('.question-scroll > .question-empty')?.textContent, copy.questionLoading);
    await act(async () => reads[1].resolve({ items: [], cursor: null }));
    assert.equal(h.document.querySelector('[role="alert"]') === null, true);
    assert.equal(h.document.querySelector('.question-scroll > .question-empty')?.textContent, copy.questionEmpty);
  } finally { await h.close(); t.mock.timers.reset(); }
});

test('search debounce and an in-flight refresh retain existing history until matching results arrive', async t => {
  const next = deferred<QuestionPage>(); let calls = 0;
  const copy = getCopy('en');
  const h = await historyMount({ listQuestions: async () => ++calls === 1
    ? { items: [{ ...q, savedSites: 0, answers: [] }], cursor: null } : next.promise }, { open: false });
  t.mock.timers.enable({ apis: ['setTimeout'] });
  try {
    await h.rerender({ open: true });
    await act(async () => t.mock.timers.tick(200));
    await h.input(h.document.querySelector<HTMLInputElement>('.question-search input')!, 'missing');
    assert.equal(h.document.querySelectorAll('.question-main').length, 1);
    assert.equal(h.document.querySelector('.question-scroll')?.getAttribute('aria-busy'), 'false');
    await act(async () => t.mock.timers.tick(200));
    assert.equal(h.document.querySelectorAll('.question-main').length, 1);
    assert.equal(h.document.querySelector('.question-scroll')?.getAttribute('aria-busy'), 'true');
    await act(async () => next.resolve({ items: [], cursor: null }));
    assert.equal(h.document.querySelectorAll('.question-main').length, 0);
    assert.equal(h.document.querySelector('.question-scroll > .question-empty')?.textContent, copy.questionNoResults);
  } finally { await h.close(); t.mock.timers.reset(); }
});
