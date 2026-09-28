import assert from "node:assert/strict";
import test from "node:test";
import { BroadcastCoordinator } from "../src/main/broadcast";
import { beginSubmissionRun, effectiveStatus, preserveSubmission, statusForResult, statusForSending } from "../src/main/status";
import type { SiteResult, SiteRunResult, SiteStatus } from "../src/shared/protocol";
import type { SiteKey } from "../src/shared/contracts";

const preferred = { requested: "think", outcome: "preferred", observed: "think", model: "Known model" } as const;
const modeOnly = { requested: "fast", outcome: "mode_only", observed: "fast" } as const;
const unconfirmed = { requested: "think", outcome: "unconfirmed" } as const;

test("result status retains bounded selection and submission evidence even on a send failure", () => {
  const result = { ok: false, code: "attachment_failed", selection: preferred, submissionEvidence: "composer" } as const;
  assert.deepEqual(statusForResult("claude", result, "run"), {
    site: "claude", phase: "failed", code: "attachment_failed",
    selection: preferred, submissionEvidence: "composer",
    submission: { runId: "run", state: "failed", code: "attachment_failed", selection: preferred, submissionEvidence: "composer" }
  });
});

test("status normalization downgrades incomplete, contradictory or unbounded model claims", () => {
  const malformed = [
    { ...preferred, observed: "fast" }, { ...preferred, observed: undefined },
    { ...preferred, model: undefined }, { ...preferred, model: "" },
    { ...preferred, model: "x".repeat(81) }, { ...preferred, model: "Model\nprivate content" },
    { ...preferred, model: "Model\tprivate content" }, { ...preferred, model: "Model\u2028extra" },
    { ...preferred, outcome: "mode_only" }, { ...preferred, outcome: "unknown" }
  ];
  for (const selection of malformed) {
    const status = statusForResult("claude", { ok: true, selection } as SiteResult, "run");
    assert.deepEqual(status.selection, unconfirmed);
    assert.deepEqual(status.submission?.selection, unconfirmed);
  }
  for (const selection of [null, [], "think", { ...preferred, requested: "unknown" }]) {
    assert.equal(statusForResult("claude", { ok: true, selection } as unknown as SiteResult).selection, undefined);
  }
});

test("valid alternative and mode-only claims survive while extra payload is discarded", () => {
  for (const selection of [preferred, { ...preferred, outcome: "alternative" }, modeOnly, unconfirmed]) {
    const result = { ok: true, selection: { ...selection, privateText: "must not cross" }, submissionEvidence: "message" };
    const status = statusForResult("claude", result as SiteResult);
    assert.deepEqual(status.selection, selection);
    assert.equal(status.submissionEvidence, "message");
  }
  assert.equal(statusForResult("claude", { ok: true, submissionEvidence: "received" } as unknown as SiteResult).submissionEvidence, undefined);
});

test("generation and completion keep this run's evidence; a new run and per-site retry clear it", () => {
  const sent = statusForResult("claude", { ok: true, selection: preferred, submissionEvidence: "message" }, "old");
  const generating = preserveSubmission(sent, { site: "claude", phase: "generating" });
  const completed = preserveSubmission(generating, { site: "claude", phase: "complete" });
  for (const status of [generating, completed]) {
    assert.deepEqual(status.selection, preferred);
    assert.equal(status.submissionEvidence, "message");
    assert.deepEqual(status.submission, sent.submission);
  }
  const crashed = effectiveStatus(completed, { site: "claude", phase: "crashed", code: "renderer_crashed" });
  assert.deepEqual(crashed.submission, sent.submission);
  assert.deepEqual(preserveSubmission(completed, statusForSending("claude", "old")), {
    site: "claude", phase: "sending", submission: { runId: "old", state: "sending" }
  });
  const statuses = new Map<SiteKey, SiteStatus>([["claude", completed], ["kimi", statusForResult("kimi", { ok: true, selection: modeOnly })]]);
  beginSubmissionRun(true, statuses, () => {});
  assert.deepEqual(statuses.get("claude")?.selection, preferred);
  beginSubmissionRun(false, statuses, () => {});
  assert.deepEqual([...statuses.values()], [{ site: "claude", phase: "complete" }, { site: "kimi", phase: "submitted" }]);
});

test("broadcast normalizes and forwards evidence to results and the observer without retrying", async () => {
  for (const ok of [true, false]) {
    const events: SiteRunResult[] = [];
    let calls = 0;
    const results = await new BroadcastCoordinator(() => 1_000).send(
      { text: "question", tier: "think", sites: ["claude"], images: [] },
      async () => {
        calls += 1;
        return { ok, ...(ok ? {} : { code: "submit_unconfirmed" }), selection: preferred, submissionEvidence: "message" };
      }, 2_000, result => events.push(result)
    );
    assert.equal(calls, 1);
    assert.deepEqual(results, [{ site: "claude", ok, ...(ok ? {} : { code: "submit_unconfirmed" }), selection: preferred, submissionEvidence: "message" }]);
    assert.deepEqual(events, results);
  }
  const malformed = await new BroadcastCoordinator(() => 1_000).send(
    { text: "question", tier: "think", sites: ["claude"], images: [] },
    async () => ({ ok: true, selection: { ...preferred, model: "x".repeat(81) }, submissionEvidence: "not-evidence" }) as unknown as SiteResult,
    2_000
  );
  assert.deepEqual(malformed, [{ site: "claude", ok: true, selection: unconfirmed }]);
});

test("read-only legacy submission recovery keeps mode evidence without inventing this-round message evidence", async () => {
  const results = await new BroadcastCoordinator(() => 1_000).send(
    { text: "question", tier: "think", sites: ["kimi"], images: [] },
    async () => ({ ok: false, code: "submit_unconfirmed", selection: preferred }), 2_000, undefined,
    { confirm: async () => ({ supported: true, ok: true }) }
  );
  assert.deepEqual(results, [{ site: "kimi", ok: true, selection: preferred }]);
});

test("read-only submission recovery retains a warning when mode selection remains unconfirmed", async () => {
  let calls = 0;
  const results = await new BroadcastCoordinator(() => 1_000).send(
    { text: "question", tier: "think", sites: ["kimi"], images: [] },
    async () => {
      calls += 1;
      return { ok: false, code: "submit_unconfirmed", selection: unconfirmed };
    }, 2_000, undefined, { confirm: async () => ({ supported: true, ok: true }) }
  );
  assert.equal(calls, 1);
  assert.deepEqual(results, [{ site: "kimi", ok: true, code: "tier_unconfirmed", selection: unconfirmed }]);
  const status = statusForResult("kimi", results[0], "run");
  assert.equal(status.phase, "warning");
  assert.equal(status.submission?.state, "sent");
  assert.equal(status.submission?.code, "tier_unconfirmed");
  assert.equal(status.submissionEvidence, undefined);
});
