import assert from 'node:assert/strict';
import test from 'node:test';
import { QuestionReaderSession } from '../src/renderer/question-reader-session';
import { questionFixture, questionAnswerFixture } from './question-fixtures';
const question = { ...questionFixture(), sites: ['claude', 'kimi'] as const };
const a = questionAnswerFixture(question.id, 1), newer = questionAnswerFixture(question.id, 2);
const detail = { question, answers: [a, newer] };
test('reader session keeps per-site attempts and independent answer positions', () => {
  const session = new QuestionReaderSession(); session.select(detail, 'claude', a.id); session.remember(a.id, 180);
  session.select(detail, 'kimi'); assert.equal(session.answer(detail, 'claude'), a.id);
  session.remember(newer.id, 90); assert.equal(session.position(a.id), 180); assert.equal(session.position(newer.id), 90);
  session.remember(a.id, -2); assert.equal(session.position(a.id), 0);
});
test('removed attempts and sites fall back without mixing another question', () => {
  const session = new QuestionReaderSession(); session.select(detail, 'claude', a.id);
  assert.equal(session.answer({ ...detail, answers: [newer] }, 'claude'), newer.id);
  assert.equal(session.preferredAnswer('other'), undefined);
  session.select(detail, 'kimi'); assert.equal(session.site({ ...detail, question: { ...question, sites: ['claude'] } }), 'claude');
});
