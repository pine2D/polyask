import assert from 'node:assert/strict';
import test from 'node:test';
import { BroadcastCoordinator } from '../src/main/broadcast';
import { completeRun, retryRequest, uncertainRunSites } from '../src/renderer/broadcast-run';
import type { BroadcastRequest, SiteResult } from '../src/shared/protocol';

test('cancelling after a page submit cannot make its result safe for default retry', async () => {
  const coordinator = new BroadcastCoordinator();
  const request: BroadcastRequest = { runId: 'cancel-after-submit', text: 'Ask exactly once', tier: null,
    sites: ['kimi'], images: [] };
  let release!: (result: SiteResult) => void, submits = 0;
  const pending = coordinator.send(request, async () => {
    submits++;
    return new Promise(resolve => { release = resolve; });
  }, 44000);
  assert.equal(submits, 1, 'the page submit already happened before cancellation');
  coordinator.cancel(); release({ ok: true, submissionEvidence: 'message' });
  const results = await pending;
  assert.equal(results[0].code, 'cancelled');
  const run = completeRun(request, results);
  assert.equal(retryRequest(run), null, 'a cancellation cannot prove the server did not receive the question');
  assert.deepEqual(uncertainRunSites(run), ['kimi']);
  assert.equal(retryRequest(run, 'kimi'), null);
  assert.deepEqual(retryRequest(run, ['kimi'], true)?.sites, ['kimi']);
  assert.equal(submits, 1);
});
