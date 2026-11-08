import assert from 'node:assert/strict';
import test from 'node:test';
import { DesktopDatabase } from '../src/main/database';
import { QuestionHistoryService } from '../src/main/question-history-service';
import { isStoredQuestionAnswer } from '../src/shared/question-history';
import { questionAnswerFixture } from './question-fixtures';

const request = { runId: 'run', sites: ['claude'] as const, text: 'Question', tier: 'think' as const, images: [] };
function setup() {
  const db = DesktopDatabase.open(':memory:');
  let now = 10, id = 0;
  const history = new QuestionHistoryService(db.questions, { deviceId: () => 'local', now: () => ++now, createId: () => id++ === 0 ? 'q' : 'q-new' });
  history.begin(request);
  return { db, history, answer: () => db.questions.answers('q').at(-1)! };
}
for (const selection of [
  { requested: 'think', outcome: 'preferred', observed: 'think', model: 'Example Pro' },
  { requested: 'think', outcome: 'alternative', observed: 'think', model: 'Example Light' },
  { requested: 'think', outcome: 'mode_only', observed: 'think' },
  { requested: 'think', outcome: 'unconfirmed' }
] as const) test(`attempt persists ${selection.outcome} as webpage observation`, () => {
  const { db, history, answer } = setup();
  try {
    (history.result as any)('run', { site: 'claude', ok: true, selection }, history.token('claude'));
    const saved = answer() as any;
    assert.equal(saved.schema, 6);
    assert.deepEqual(saved.observation?.selection, selection);
    assert.equal(saved.observation?.questionId, 'q');
    assert.equal(saved.observation?.attempt, 1);
    assert.equal(saved.observation?.site, 'claude');
    assert.equal(saved.observation?.observedAt, saved.updatedAt);
    assert.equal((db.questions.search().items[0].answers[0] as any).observation?.selection.outcome, selection.outcome);
  } finally { db.close(); }
});
test('invalid model text normalizes to unconfirmed; absent selection stays unrecorded', () => {
  const { db, history, answer } = setup();
  try {
    (history.result as any)('run', { site: 'claude', ok: true, selection: { requested: 'think', observed: 'think', outcome: 'preferred', model: 'bad\nmodel' } }, history.token('claude'));
    assert.equal((answer() as any).observation?.selection.outcome, 'unconfirmed');
    history.begin(request);
    (history.result as any)('run', { site: 'claude', ok: true }, history.token('claude'));
    assert.equal((answer() as any).observation, null);
  } finally { db.close(); }
});
test('old attempt results and held late success cannot change a retry or its observation', () => {
  const { db, history, answer } = setup();
  try {
    const oldToken = history.token('claude');
    history.begin(request);
    (history.result as any)('run', { site: 'claude', ok: true }, oldToken);
    assert.equal(answer().submission, 'pending');
    history.holdSubmission(['claude']);
    (history.result as any)('run', { site: 'claude', ok: true }, history.token('claude'));
    assert.equal(answer().submission, 'pending');
    (history.result as any)('run', { site: 'claude', ok: false, code: 'cancelled' }, history.token('claude'));
    assert.equal(answer().submission, 'cancelled');
  } finally { db.close(); }
});
test('schema 4 remains readable and cannot hide new observation fields', () => {
  const old = questionAnswerFixture();
  assert.equal(isStoredQuestionAnswer(old), true);
  assert.equal(isStoredQuestionAnswer({ ...old, observation: null }), false);
  assert.equal(isStoredQuestionAnswer({ ...old, schema: 6, observation: null }), true);
});
test('sealed observations reject later ordinary local writes', () => {
  const { db, history, answer } = setup();
  try {
    (history.result as any)('run', { site: 'claude', ok: true, selection: { requested: 'think', outcome: 'mode_only', observed: 'think' } }, history.token('claude'));
    history.cancel(['claude']);
    const saved = answer();
    db.questions.putAnswer({ ...saved, updatedAt: saved.updatedAt + 10, observation: null } as any);
    assert.equal((answer() as any).observation?.selection.outcome, 'mode_only');
  } finally { db.close(); }
});
test('duplicate terminal result cannot overwrite the first observation; new runs reject the old token', () => {
  const { db, history, answer } = setup();
  try {
    const token = history.token('claude');
    (history.result as any)('run', { site: 'claude', ok: false, code: 'submit_unconfirmed', selection: { requested: 'think', outcome: 'unconfirmed' } }, token);
    (history.result as any)('run', { site: 'claude', ok: true, selection: { requested: 'think', observed: 'think', outcome: 'mode_only' } }, token);
    assert.equal((answer() as any).observation.selection.outcome, 'unconfirmed');
    assert.equal(answer().submission, 'unconfirmed');
    history.accept('claude', { token: token!, owned: true, locate: 'selector', text: 'Late answer', generation: 'generating' });
    assert.equal(answer().submission, 'submitted');
    assert.equal((answer() as any).observation.selection.outcome, 'unconfirmed');
    const next = history.begin({ ...request, runId: 'new-run' })!;
    (history.result as any)('run', { site: 'claude', ok: true }, token);
    assert.equal(db.questions.answers(next.id)[0].submission, 'pending');
  } finally { db.close(); }
});
test('a newer sealed restore from another device follows existing answer LWW merge rules', () => {
  const { db, history, answer } = setup();
  try {
    (history.result as any)('run', { site: 'claude', ok: true, selection: { requested: 'think', outcome: 'mode_only', observed: 'think' } }, history.token('claude'));
    history.cancel(['claude']);
    const saved = answer();
    const remote = { ...saved, updatedAt: saved.updatedAt + 10, deviceId: 'restored-device', observation: null };
    db.questions.putAnswer(remote, false);
    assert.equal(answer().observation, null);
    assert.equal(answer().updatedAt, remote.updatedAt);
  } finally { db.close(); }
});
test('stored observations reject mismatched identity, unsafe models, unknown fields and out-of-range timestamps', () => {
  const base = questionAnswerFixture();
  const observation = { questionId: base.questionId, site: base.site, attempt: base.attempt, observedAt: 10,
    selection: { requested: 'think', observed: 'think', outcome: 'preferred', model: 'Example Pro' } };
  for (const invalid of [
    { ...observation, questionId: 'other' }, { ...observation, site: 'chatgpt' }, { ...observation, attempt: 2 },
    { ...observation, observedAt: 9 }, { ...observation, observedAt: 11 }, { ...observation, secret: 'extra' },
    { ...observation, selection: { ...observation.selection, model: 'x'.repeat(81) } },
    { ...observation, selection: { ...observation.selection, model: 'bad\u202emodel' } },
    { ...observation, selection: { ...observation.selection, extra: true } }
  ]) assert.equal(isStoredQuestionAnswer({ ...base, schema: 6, observation: invalid }), false);
});
