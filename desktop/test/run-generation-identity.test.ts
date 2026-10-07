import assert from 'node:assert/strict';
import test from 'node:test';
import { beginSubmissionRun, effectiveStatus, preserveSubmission, statusForResult } from '../src/main/status';
import { generationObservationStatus } from '../src/main/generation-probe-scheduler';
import { upgradedSubmissionStatus } from '../src/main/submission-upgrade';
import type { SiteStatus } from '../src/shared/protocol';
import type { SiteKey } from '../src/shared/contracts';

test('submission establishes generation identity while a page failure retains it separately', () => {
  const submitted = statusForResult('claude', { ok: true }, 'run-a') as any;
  assert.equal(submitted.generation?.runId, 'run-a');
  assert.equal(submitted.generation?.state, 'submitted');
  const failed = effectiveStatus(submitted, { site: 'claude', phase: 'crashed', code: 'renderer_crashed' }) as any;
  assert.equal(failed.phase, 'crashed'); assert.equal(failed.generation?.runId, 'run-a');
  assert.equal(failed.submission?.state, 'sent');
});

test('generation changes keep their run identity and exhausted observation becomes unconfirmed', () => {
  const previous = { site: 'claude', phase: 'submitted', submission: { runId: 'run-a', state: 'sent' },
    generation: { runId: 'run-a', state: 'submitted' } } as SiteStatus;
  const generating = preserveSubmission(previous, { site: 'claude', phase: 'generating' }) as any;
  assert.equal(generating.generation?.runId, 'run-a'); assert.equal(generating.generation?.state, 'generating');
  const stopped = generationObservationStatus(generating) as any;
  assert.equal(stopped.generation?.runId, 'run-a'); assert.equal(stopped.generation?.state, 'unconfirmed');
  assert.equal(stopped.submission?.state, 'sent');
});

test('a new broadcast clears old generation evidence on sites outside its scope while same-run retry retains it', () => {
  const statuses = new Map<SiteKey, SiteStatus>([['claude', { site: 'claude', phase: 'complete',
    generation: { runId: 'old', state: 'complete' } } as SiteStatus]]);
  const published: string[] = [];
  beginSubmissionRun(true, statuses, site => published.push(site));
  assert.equal((statuses.get('claude') as any).generation?.runId, 'old');
  beginSubmissionRun(false, statuses, site => published.push(site));
  assert.equal((statuses.get('claude') as any).generation, undefined);
  assert.deepEqual(published, ['claude']);
});

test('exhausted observation clears generating evidence even while a page fault remains visible', () => {
  const crashed: SiteStatus = { site: 'claude', phase: 'crashed', code: 'renderer_crashed',
    submission: { runId: 'a', state: 'sent' }, generation: { runId: 'a', state: 'generating' } };
  const stopped = generationObservationStatus(crashed);
  assert.equal(stopped.phase, 'crashed'); assert.equal(stopped.code, 'renderer_crashed');
  assert.equal(stopped.generation?.state, 'unconfirmed');
});

test('late readonly submission confirmation establishes the same generation identity as normal submission', () => {
  const upgraded = upgradedSubmissionStatus({ site: 'claude', phase: 'failed',
    submission: { runId: 'a', state: 'unconfirmed' } }, 'a');
  assert.equal(upgraded?.generation?.runId, 'a'); assert.equal(upgraded?.generation?.state, 'submitted');
});
