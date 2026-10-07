import assert from 'node:assert/strict';
import test from 'node:test';
import { DesktopDatabase } from '../src/main/database';
import { QuestionHistoryService, SEAL_QUIET_MS } from '../src/main/question-history-service';
import type { SiteKey } from '../src/shared/contracts';

const request = (sites: readonly SiteKey[] = ['claude', 'kimi']) => ({ runId: 'run-a', sites,
  text: 'Synthetic progress question', tier: null, images: [] });
// Optional lookup lets the first regression express missing UI evidence without an import/type failure.
const progress = (history: QuestionHistoryService) => (history as any).getRunProgress?.('run-a') ?? null;
test('run progress uses latest attempts and returns finite metadata without saved text or URLs', () => {
  const db = DesktopDatabase.open(':memory:');
  const history = new QuestionHistoryService(db.questions, { deviceId: () => 'local' });
  try {
    const question = history.begin(request())!;
    const first = progress(history);
    assert.equal(first?.state, 'available'); assert.equal(first?.questionId, question.id);
    assert.equal(first?.answers.length, 2);
    assert.equal(first?.answers.every((a: any) => a.attempt === 1 && !a.hasText), true);
    history.result('run-a', { site: 'claude', ok: true });
    history.accept('claude', { token: history.token('claude')!, owned: true, text: 'Partial saved body', generation: 'generating' });
    const captured = progress(history);
    assert.equal(captured?.answers.find((a: any) => a.site === 'claude')?.hasText, true);
    assert.equal(JSON.stringify(captured).includes('Partial saved body'), false);
    assert.equal(captured?.answers.some((a: any) => 'answerMarkdown' in a || 'conversationUrl' in a), false);
    history.begin(request(['claude']));
    const retry = progress(history);
    assert.equal(retry?.answers.find((a: any) => a.site === 'claude')?.attempt, 2);
    assert.equal(retry?.answers.find((a: any) => a.site === 'claude')?.hasText, false);
    assert.equal(retry?.answers.find((a: any) => a.site === 'kimi')?.attempt, 1);
  } finally { db.close(); }
});

test('positive completion alone cannot count a complete copy before the post-confirmation reread seals it', () => {
  const db = DesktopDatabase.open(':memory:'); let now = 1000;
  const history = new QuestionHistoryService(db.questions, { deviceId: () => 'local', now: () => ++now });
  try {
    history.begin(request(['claude'])); history.result('run-a', { site: 'claude', ok: true });
    const token = history.token('claude')!;
    history.accept('claude', { token, owned: true, text: 'Final body', generation: null }, history.readMark());
    history.complete('run-a', 'claude');
    assert.equal(progress(history)?.answers[0]?.capture, 'unknown');
    history.accept('claude', { token, owned: true, text: 'Final body', generation: null }, history.readMark());
    assert.equal(progress(history)?.answers[0]?.sealedAt, null);
    now += SEAL_QUIET_MS;
    history.accept('claude', { token, owned: true, text: 'Final body', generation: null }, history.readMark());
    assert.equal(progress(history)?.answers[0]?.capture, 'complete');
    assert.equal(typeof progress(history)?.answers[0]?.sealedAt, 'number');
  } finally { db.close(); }
});

test('deleted, reset and failed storage never expose complete counts or block the sending caller', () => {
  const db = DesktopDatabase.open(':memory:');
  const history = new QuestionHistoryService(db.questions, { deviceId: () => 'local' });
  const question = history.begin(request())!;
  history.delete(question.id);
  assert.equal(progress(history)?.state, 'unavailable'); assert.equal(progress(history)?.answers.length, 0);
  db.resetLocalData();
  assert.equal(progress(history)?.state, 'unavailable');
  db.close();
  const failed = new QuestionHistoryService(db.questions, { deviceId: () => 'local' });
  assert.equal(failed.begin(request()), null);
  assert.equal(progress(failed)?.state, 'unavailable'); assert.equal(progress(failed)?.questionId, null);
});

test('an external history change has a newer metadata revision when reread', () => {
  const db = DesktopDatabase.open(':memory:');
  const history = new QuestionHistoryService(db.questions, { deviceId: () => 'local' });
  try {
    const question = history.begin(request())!, first = progress(history);
    db.questions.delete(question.id, Date.now(), 'local');
    const changed = progress(history);
    assert.equal(changed?.state, 'unavailable'); assert.equal(changed.revision > first.revision, true);
  } finally { db.close(); }
});
