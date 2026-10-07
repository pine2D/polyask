import assert from 'node:assert/strict';
import test from 'node:test';
import { runProgressCounts } from '../src/renderer/run-progress-model';
import type { SiteStatus } from '../src/shared/protocol';
import type { QuestionRunAnswerProgress, QuestionRunProgress } from '../src/shared/question-run-progress';

const answer = (patch: Partial<QuestionRunAnswerProgress> = {}): QuestionRunAnswerProgress => ({
  id: 'answer-1', site: 'claude', attempt: 1, submission: 'submitted', capture: 'waiting',
  hasText: false, truncated: false, sealedAt: null, ...patch });
const progress = (...answers: QuestionRunAnswerProgress[]): QuestionRunProgress => ({ runId: 'run-a',
  questionId: 'question-a', revision: 1, state: 'available', answers });
const completeStatus: SiteStatus = { site: 'claude', phase: 'complete',
  submission: { runId: 'run-a', state: 'sent' }, generation: { runId: 'run-a', state: 'complete' } };
test('submission, positive generation end and saved completeness count three distinct facts', () => {
  const counts = runProgressCounts('run-a', ['claude'], { claude: completeStatus }, progress(answer()));
  assert.equal(counts.submitted, 1); assert.equal(counts.ended, 1); assert.equal(counts.complete, 0);
  for (const patch of [{ capture: 'unknown', hasText: true }, { capture: 'partial', hasText: true },
    { capture: 'complete', hasText: true, truncated: true, sealedAt: 1 },
    { capture: 'complete', hasText: true, sealedAt: null }] as const) {
    const incomplete = runProgressCounts('run-a', ['claude'], { claude: completeStatus }, progress(answer(patch)));
    assert.equal(incomplete.complete, 0); assert.equal(incomplete.hasReadableCopy, true);
  }
  assert.equal(runProgressCounts('run-a', ['claude'], {}, progress(answer({ capture: 'complete', hasText: true, sealedAt: 1 }))).complete, 1);
});
test('old, auxiliary and out-of-scope generation or copies never contribute to this run', () => {
  const statuses: Record<string, SiteStatus> = { claude: { site: 'claude', phase: 'generating',
    submission: { runId: 'old', state: 'sent' }, generation: { runId: 'synthesis-one', state: 'generating' } } };
  const counts = runProgressCounts('run-a', ['claude'], statuses, { ...progress(answer({ hasText: true, capture: 'complete', sealedAt: 1 })), runId: 'old' });
  assert.equal(counts.submitted, 0); assert.equal(counts.generating, 0); assert.equal(counts.complete, 0);
  assert.equal(runProgressCounts('run-a', ['kimi'], {}, progress(answer({ hasText: true, capture: 'complete', sealedAt: 1 }))).complete, 0);
});
test('latest retry evidence replaces an older complete copy and closed-site submission remains countable', () => {
  const latest = progress(answer({ capture: 'complete', hasText: true, sealedAt: 1 }), answer({ id: 'answer-2', attempt: 2, submission: 'pending' }));
  const counts = runProgressCounts('run-a', ['claude'], {}, latest);
  assert.equal(counts.complete, 0); assert.equal(counts.submitted, 0);
  assert.equal(runProgressCounts('run-a', ['claude'], {}, progress(answer())).submitted, 1);
});
test('exceptions stay separate and inaccessible storage contributes no saved copy evidence', () => {
  const statuses: Record<string, SiteStatus> = {
    claude: { site: 'claude', phase: 'failed', submission: { runId: 'run-a', state: 'failed' } },
    kimi: { site: 'kimi', phase: 'failed', submission: { runId: 'run-a', state: 'unconfirmed' } },
    gemini: { site: 'gemini', phase: 'cancelled', submission: { runId: 'run-a', state: 'cancelled' } }
  };
  const counts = runProgressCounts('run-a', ['claude', 'kimi', 'gemini'], statuses,
    { ...progress(answer({ capture: 'complete', hasText: true, sealedAt: 1 })), state: 'unavailable' });
  assert.equal(counts.failed, 1); assert.equal(counts.unconfirmed, 1); assert.equal(counts.cancelled, 1);
  assert.equal(counts.complete, 0); assert.equal(counts.hasReadableCopy, false);
});
test('a pending retry cannot inherit the previous attempt generation completion or activity', () => {
  const pending = progress(answer({ id: 'answer-2', attempt: 2, submission: 'pending' }));
  assert.equal(runProgressCounts('run-a', ['claude'], { claude: completeStatus }, pending).ended, 0);
  assert.equal(runProgressCounts('run-a', ['claude'], { claude: { ...completeStatus,
    generation: { runId: 'run-a', state: 'generating' } } }, pending).generating, 0);
});
