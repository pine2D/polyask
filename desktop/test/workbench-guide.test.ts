import assert from 'node:assert/strict';
import test from 'node:test';
import type { SiteKey } from '../src/shared/contracts';
import type { QuestionRunAnswerProgress, QuestionRunProgress } from '../src/shared/question-run-progress';
import { projectWorkbenchGuide, type WorkbenchGuideInput } from '../src/renderer/workbench-guide-model';

const input: WorkbenchGuideInput = { ready: true, busy: false, preference: null, dismissed: false,
  participating: ['claude', 'kimi'], runId: null, activeSites: [], statuses: {}, progress: null };
function answer(site: SiteKey, overrides: Partial<QuestionRunAnswerProgress> = {}): QuestionRunAnswerProgress {
  return { id: site, site, attempt: 1, submission: 'submitted', capture: 'complete', hasText: true,
    truncated: false, sealedAt: 20, ...overrides };
}
function progress(answers: readonly QuestionRunAnswerProgress[], overrides: Partial<QuestionRunProgress> = {}): QuestionRunProgress {
  return { runId: 'run-a', questionId: 'question-a', revision: 1, state: 'available', answers, ...overrides };
}
const run = { runId: 'run-a', activeSites: ['claude', 'kimi'] as const };

test('an unmarked ready guide suggests two participants without changing a nine-page workspace', () => {
  assert.equal(projectWorkbenchGuide({ ...input, participating: ['claude', 'kimi', 'gemini'] }).stage, 'choose');
  assert.equal(projectWorkbenchGuide({ ...input, participating: [] }).stage, 'choose');
  assert.equal(projectWorkbenchGuide(input).stage, 'ask');
});

test('not-ready, operation locks and finite dismissed/completed preferences hide automatic guidance', () => {
  for (const patch of [{ ready: false }, { busy: true }, { dismissed: true },
    { preference: { version: 1, disposition: 'dismissed' } }, { preference: { version: 1, disposition: 'completed' } }] as const) {
    assert.equal(projectWorkbenchGuide({ ...input, ...patch }).stage, 'hidden');
  }
});

test('two confirmed submissions with no saved text stay waiting even after positive generation end', () => {
  const model = projectWorkbenchGuide({ ...input, ...run, statuses: {
    claude: { site: 'claude', phase: 'ready', submission: { runId: 'run-a', state: 'sent' }, generation: { runId: 'run-a', state: 'complete' } },
    kimi: { site: 'kimi', phase: 'ready', submission: { runId: 'run-a', state: 'sent' }, generation: { runId: 'run-a', state: 'complete' } }
  } });
  assert.equal(model.stage, 'waiting');
  assert.equal(model.counts.ended, 2);
  assert.equal(model.target, null);
});

test('a partial saved copy opens the current question while complete copies enable an explicit comparison', () => {
  const read = projectWorkbenchGuide({ ...input, ...run, progress: progress([answer('claude', { capture: 'partial', sealedAt: null }), answer('kimi', { hasText: false })]) });
  assert.equal(read.stage, 'read');
  assert.deepEqual(read.target?.readableIds, ['claude']);
  assert.equal(read.target?.questionId, 'question-a');
  const compare = projectWorkbenchGuide({ ...input, ...run, progress: progress([answer('claude'), answer('kimi')]) });
  assert.equal(compare.stage, 'compare');
  assert.deepEqual(compare.target?.completeIds, ['claude', 'kimi']);
});

test('truncation, unknown completeness and absent seal cannot produce a complete-copy comparison', () => {
  for (const patch of [{ truncated: true }, { sealedAt: null }, { capture: 'unknown' }] as const) {
    const model = projectWorkbenchGuide({ ...input, ...run, progress: progress([answer('claude', patch), answer('kimi', patch)]) });
    assert.equal(model.stage, 'read');
    assert.equal(model.counts.complete, 0);
    assert.deepEqual(model.target?.completeIds, []);
  }
});

test('old runs, missing question identity and unavailable storage never offer a saved-copy target', () => {
  for (const patch of [{ runId: 'old-run' }, { questionId: null }, { state: 'unavailable' }] as const) {
    const model = projectWorkbenchGuide({ ...input, ...run, progress: progress([answer('claude'), answer('kimi')], patch) });
    assert.equal(model.target, null);
    assert.equal(model.stage === 'read' || model.stage === 'compare', false);
  }
});

test('a newer retry attempt replaces old complete evidence and unconfirmed submission does not count as success', () => {
  const model = projectWorkbenchGuide({ ...input, ...run, progress: progress([
    answer('claude'), answer('claude', { id: 'claude-2', attempt: 2, hasText: false, submission: 'unconfirmed', capture: 'unknown', sealedAt: null }), answer('kimi')
  ]) });
  assert.equal(model.stage, 'ask');
  assert.equal(model.counts.submitted, 1);
  assert.equal(model.target, null);
});

test('an invalid newest answer identity never revives an older complete attempt', () => {
  const model = projectWorkbenchGuide({ ...input, ...run, progress: progress([
    answer('claude'), answer('claude', { id: '', attempt: 2 }), answer('kimi')
  ]) });
  assert.equal(model.stage, 'read');
  assert.deepEqual(model.target?.readableIds, ['kimi']);
  assert.deepEqual(model.target?.completeIds, ['kimi']);
});
