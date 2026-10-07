import test from 'node:test';
import assert from 'node:assert/strict';
import { projectQuestionArchiveInput } from '../src/shared/question-archive';
import { getCopy } from '../src/shared/copy';
import { SITES } from '../src/main/sites';
import { questionFixture, questionAnswerFixture } from './question-fixtures';

for (const locale of ['en', 'zh-CN', 'zh-TW'] as const) {
  test(`snapshot labels retain original attempt, time and uncertain completion (${locale})`, () => {
    const q = { ...questionFixture(), createdAt: 0, updatedAt: 0 };
    const a = { ...questionAnswerFixture(), createdAt: 0, updatedAt: 0, capturedAt: 0, sealedAt: 0, attempt: 3,
      submission: 'unconfirmed' as const, capture: 'unknown' as const, answerMarkdown: '\n exact 😀\n' };
    const input = projectQuestionArchiveInput(q, [a], SITES, locale), result = input.results[0];
    const copy = getCopy(locale);
    assert.equal(result.text, a.answerMarkdown); assert.equal(input.source, null);
    assert.ok(result.label.includes(copy.questionAttempt.replace('{number}', '3')));
    assert.ok(result.label.includes(copy.questionStateUnknown)); assert.ok(result.label.includes(copy.questionSubmissionUnconfirmed));
    assert.ok(result.label.includes(new Date(0).toLocaleString(locale)));
    assert.ok([...result.label].length <= 256); assert.equal(result.state, undefined);
    assert.equal(result.code, undefined, 'unconfirmed does not erase a saved copy or imply truncated');
  });
}

test('snapshot preserves all stopped/partial states and true truncation without inventing a verified tier', () => {
  const copy = getCopy('en');
  for (const capture of ['partial', 'interrupted', 'waiting', 'unavailable', 'complete'] as const) {
    const a = { ...questionAnswerFixture(), capture, truncated: capture === 'partial' };
    const result = projectQuestionArchiveInput({ ...questionFixture(), requestedTier: 'think' }, [a], SITES, 'en').results[0];
    const label = { partial: copy.questionStatePartial, interrupted: copy.questionStateInterrupted,
      waiting: copy.questionStateWaiting, unavailable: copy.questionStateUnavailable, complete: copy.questionStateComplete }[capture];
    assert.ok(result.label.includes(label)); assert.equal(result.state, undefined);
    assert.equal(result.code, a.truncated ? 'answer_truncated' : undefined);
  }
});
