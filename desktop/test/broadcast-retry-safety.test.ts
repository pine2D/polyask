import assert from "node:assert/strict";
import test from "node:test";
import { completeRun, failedRunSites, cancelledRunSites, uncertainRunSites, retryRequest } from "../src/renderer/broadcast-run";
import { BroadcastFlowState } from "../src/renderer/broadcast-flow-state";
import type { BroadcastRequest } from "../src/shared/protocol";

const request: BroadcastRequest = { runId: "frozen-retry", text: "Keep the original question 😀", tier: "think",
  sites: ["claude", "chatgpt", "kimi", "gemini", "deepseek"], images: [] };
const mixed = () => completeRun(request, [
  { site: "claude", ok: false, code: "composer_not_found" },
  { site: "chatgpt", ok: false, code: "cancelled" },
  { site: "kimi", ok: false, code: "submit_unconfirmed" },
  { site: "gemini", ok: false, code: "timeout" },
  { site: "deepseek", ok: false, code: "future_failure" }
]);

test("default batch retry excludes uncertain, timed-out and unknown submissions", () => {
  assert.deepEqual(retryRequest(mixed()), { ...request, sites: ["claude"] });
  assert.deepEqual(failedRunSites(mixed()), ["claude"]);
  assert.deepEqual(cancelledRunSites(mixed()), ["chatgpt"]);
  assert.deepEqual(uncertainRunSites(mixed()), ["chatgpt", "kimi", "gemini", "deepseek"]);
});

test("a named uncertain site still requires a deliberate confirmation", () => {
  for (const site of ["chatgpt", "kimi", "gemini", "deepseek"] as const) assert.equal(retryRequest(mixed(), site), null);
});

test("explicit confirmed choices preserve the frozen payload and never expand the run", () => {
  const result = retryRequest(mixed(), ["kimi", "gemini", "doubao"], true);
  assert.deepEqual(result, { ...request, sites: ["kimi", "gemini"] });
  assert.equal(result?.images, request.images);
});

test("a successful late confirmation cannot be resent by an old confirmed selection", () => {
  const run = completeRun(request, [{ site: "kimi", ok: true, submissionEvidence: "message" }]);
  assert.equal(retryRequest(run, ["kimi"], true), null);
});

test("missing results and absent codes need explicit choices, even with a confirmation flag", () => {
  const run = completeRun(request, [{ site: "claude", ok: false }]);
  assert.deepEqual(uncertainRunSites(run), request.sites);
  assert.equal(retryRequest(run), null);
  assert.equal(retryRequest(run, undefined, true), null);
  assert.deepEqual(retryRequest(run, ["claude", "claude", "kimi"], true)?.sites, ["claude", "kimi"]);
});

test('positive sent evidence received before the reply removes every uncertain outcome', () => {
  for (const result of [undefined, {site:'kimi',ok:false,code:'timeout'},
    {site:'kimi',ok:false,code:'future_failure'}, {site:'kimi',ok:false}] as const) {
    const state = new BroadcastFlowState(), operation = state.begin(true)!;
    state.acceptSubmission('kimi', {runId:request.runId,state:'sent'});
    state.commit(operation, completeRun(request, result ? [result] : []));
    state.settle(operation);
    assert.equal(state.run!.results.get('kimi')?.ok, true);
    assert.equal(retryRequest(state.run!, ['kimi'], true), null);
  }
});

test('late positive evidence ignores unrelated scope and upgrades uncertain cancellation', () => {
  const state = new BroadcastFlowState(), operation = state.begin(true)!;
  state.commit(operation, mixed()); state.settle(operation);
  assert.equal(state.acceptSubmission('kimi', {runId:'older',state:'sent'}), false);
  assert.equal(state.acceptSubmission('doubao', {runId:request.runId,state:'sent'}), false);
  assert.equal(state.acceptSubmission('claude', {runId:request.runId,state:'sent'}), false);
  assert.equal(state.acceptSubmission('chatgpt', {runId:request.runId,state:'sent'}), true);
  assert.deepEqual(failedRunSites(state.run!), ['claude']);
  assert.deepEqual(cancelledRunSites(state.run!), []);
});

test('cached sent status preserves its actual evidence and tier warning', () => {
  const state = new BroadcastFlowState(), operation = state.begin(true)!;
  state.acceptSubmission('kimi', { runId: request.runId, state: 'sent', submissionEvidence: 'composer',
    selection: { requested: 'think', outcome: 'unconfirmed' } });
  state.commit(operation, completeRun(request, [])); state.settle(operation);
  assert.deepEqual(state.run!.results.get('kimi'), { site: 'kimi', ok: true, submissionEvidence: 'composer',
    selection: { requested: 'think', outcome: 'unconfirmed' }, code: 'tier_unconfirmed' });
});

test('late sent status without new metadata retains the saved tier and evidence', () => {
  const state = new BroadcastFlowState(), operation = state.begin(true)!;
  state.commit(operation, completeRun(request, [{ site: 'kimi', ok: false, code: 'timeout',
    submissionEvidence: 'composer', selection: { requested: 'think', outcome: 'mode_only', observed: 'think' } }]));
  state.settle(operation);
  assert.equal(state.acceptSubmission('kimi', { runId: request.runId, state: 'sent' }), true);
  assert.deepEqual(state.run!.results.get('kimi'), { site: 'kimi', ok: true, submissionEvidence: 'composer',
    selection: { requested: 'think', outcome: 'mode_only', observed: 'think' } });
});
