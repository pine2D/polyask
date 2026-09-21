import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { getCopy } from '../src/shared/copy';
import { QuestionHistoryList } from '../src/renderer/question-history-list';
import { QuestionHistoryReader } from '../src/renderer/question-history-reader';
import { answerState, questionDay } from '../src/renderer/question-history-model';
import { questionFixture, questionAnswerFixture } from './question-fixtures';
const copy = getCopy('zh-CN');
const noop = () => {};
const answerFixture = (id: string) => ({ ...questionAnswerFixture(id), capture: 'unknown' as const });
test('history separates restore, copies and menu buttons and never renders raw markup', () => {
  const q = questionFixture();
  const html = renderToStaticMarkup(<QuestionHistoryList copy={copy} sites={[]} busy={false}
    items={[{ ...q, text: '<script>test</script>', savedSites: 1, answers: [answerFixture(q.id)] }]}
    onRestore={noop} onRead={noop} onReask={noop} onDelete={noop} />);
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes(copy.questionCopies));
  let depth = 0;
  for (const match of html.matchAll(/<\/?button\b[^>]*>/g)) { depth += match[0].startsWith('</') ? -1 : 1; assert.ok(depth >= 0 && depth <= 1); }
  assert.equal(depth, 0);
});
test('reader presents uncertain completion and image limitations without claiming full answers', () => {
  const q = { ...questionFixture(), inputImageCount: 2 };
  const html = renderToStaticMarkup(<QuestionHistoryReader detail={{ question: q, answers: [answerFixture(q.id)] }} copy={copy} sites={[]} busy={false}
    onRestore={noop} onReask={noop} onDelete={noop} onAnnounce={noop} />);
  assert.ok(html.includes(copy.questionStateUnknown));
  assert.ok(html.includes('2 张图片'));
  assert.equal(answerState({ submission: 'unconfirmed', capture: 'unknown' }, copy), `${copy.questionSubmissionUnconfirmed} · ${copy.questionStateUnknown}`);
  const now = new Date(2026, 8, 21, 0, 1).getTime();
  assert.equal(questionDay(now - 120000, now, copy), copy.questionYesterday);
});
test('inactive history never overrides a new-session confirmation surface', async () => {
  const { questionHistorySurface } = await import('../src/renderer/question-history-model');
  assert.equal(questionHistorySurface(false, false), null);
  assert.equal(questionHistorySurface(true, true), 'question-history');
  assert.equal(questionHistorySurface(true, false), 'sites');
});
