import assert from "node:assert/strict";
import test from "node:test";
import { DesktopDatabase } from "../src/main/database";
import { GenerationMonitor } from "../src/main/generation-monitor";
import { createQuestionCapture } from "../src/main/question-capture-binding";
import { QuestionCaptureService } from "../src/main/question-capture-service";
import { QuestionHistoryService, SEAL_QUIET_MS } from "../src/main/question-history-service";
import type { ViewManager } from "../src/main/view-manager";
import type { SiteKey } from "../src/shared/contracts";
import type { HistorySnapshot } from "../src/shared/question-capture";
import { isStoredQuestionAnswer } from "../src/shared/question-history";

const request = (runId: string, text = "Question") => ({ runId, sites: ["claude"] as SiteKey[], text, tier: null, images: [] });
function fixture(runId = "run-a") {
  const db = DesktopDatabase.open(":memory:");
  let now = 1000;
  const history = new QuestionHistoryService(db.questions, { deviceId: () => "local", now: () => ++now });
  const q = history.begin(request(runId))!;
  const token = history.token("claude")!;
  const advance = (ms: number) => { now += ms; };
  // Candidate read, then a read started after the quiet window with the same text.
  const settle = (text: string) => {
    history.accept("claude", { token, owned: true, text, generation: null }, history.readMark());
    advance(SEAL_QUIET_MS);
    history.accept("claude", { token, owned: true, text, generation: null }, history.readMark());
  };
  return { db, history, q, token, advance, settle, answer: () => db.questions.answers(q.id).at(-1)! };
}

test("monitor-confirmed completion seals an owned answer that stays unchanged across the quiet window", () => {
  const { db, history, token, advance, answer } = fixture();
  try {
    assert.equal(history.complete("run-a", "claude"), false, "a pending submission cannot be confirmed");
    history.result("run-a", { site: "claude", ok: true });
    history.accept("claude", { token, owned: true, text: "Partial", generation: "generating" }, history.readMark());
    assert.equal(history.complete("other-run", "claude"), false, "another run's monitor cannot confirm this copy");
    assert.equal(history.complete("run-a", "claude"), true);
    assert.equal(answer().capture, "partial", "confirmation alone does not persist anything");
    history.accept("claude", { token, owned: true, text: "Final answer", url: null, generation: null }, history.readMark());
    assert.equal(answer().sealedAt, null, "the first read after confirmation is only a candidate");
    assert.ok((history.sealDelay() ?? Infinity) <= SEAL_QUIET_MS, "the service is told when to re-read");
    advance(SEAL_QUIET_MS);
    history.accept("claude", { token, owned: true, text: "Final answer", url: null, generation: null }, history.readMark());
    const sealed = answer();
    assert.equal(sealed.capture, "complete");
    assert.equal(sealed.answerMarkdown, "Final answer");
    assert.notEqual(sealed.sealedAt, null);
    assert.equal(isStoredQuestionAnswer(sealed), true, "sync and backup validation accept the sealed record");
    assert.equal(history.releasable("claude"), true);
    assert.deepEqual(history.targets(), []);
  } finally { db.close(); }
});

test("a follow-up, cancel or later snapshot leaves a sealed complete copy untouched", () => {
  const { db, history, token, settle, answer } = fixture();
  try {
    history.result("run-a", { site: "claude", ok: true });
    history.complete("run-a", "claude");
    settle("Final answer");
    const sealed = answer();
    assert.equal(sealed.capture, "complete");
    // The same-conversation follow-up ends ownership of the bound turn.
    history.accept("claude", { token, owned: false, ended: true });
    history.accept("claude", { token, owned: true, text: "Follow-up text", generation: "generating" }, history.readMark());
    history.cancel(["claude"]);
    assert.deepEqual(answer(), sealed);
    history.begin(request("run-b"));
    assert.deepEqual(db.questions.answers(sealed.questionId).find(a => a.id === sealed.id), sealed);
  } finally { db.close(); }
});

test("without monitor confirmation a follow-up keeps the existing interrupted outcome", () => {
  const { db, history, token, answer } = fixture();
  try {
    history.result("run-a", { site: "claude", ok: true });
    for (let i = 0; i < 4; i++) history.accept("claude", { token, owned: true, text: "Quiet answer", generation: null }, history.readMark());
    assert.equal(answer().sealedAt, null, "quiet text never implies completion");
    history.accept("claude", { token, owned: false, ended: true });
    assert.equal(answer().capture, "interrupted");
  } finally { db.close(); }
});

test("only reads started after the confirmation can seal; ended, truncated or generating snapshots cannot", () => {
  const { db, history, token, advance, answer } = fixture();
  try {
    history.result("run-a", { site: "claude", ok: true });
    const early = history.readMark();
    history.complete("run-a", "claude");
    history.accept("claude", { token, owned: true, text: "Stale in-flight text", generation: null }, early);
    advance(SEAL_QUIET_MS);
    history.accept("claude", { token, owned: true, text: "Stale in-flight text", generation: null }, early);
    assert.equal(answer().sealedAt, null);
    // A snapshot without a read mark has unknown provenance and fails closed.
    history.accept("claude", { token, owned: true, text: "Unmarked", generation: null });
    advance(SEAL_QUIET_MS);
    history.accept("claude", { token, owned: true, text: "Unmarked", generation: null });
    assert.equal(answer().sealedAt, null);
    assert.equal(history.sealDelay(), null, "unmarked or stale reads never become seal candidates");
    history.accept("claude", { token, owned: true, text: "Long", generation: null, truncated: true }, history.readMark());
    advance(SEAL_QUIET_MS);
    history.accept("claude", { token, owned: true, text: "Long", generation: null, truncated: true }, history.readMark());
    assert.equal(answer().sealedAt, null);
    history.accept("claude", { token, owned: true, generation: null }, history.readMark());
    assert.equal(answer().sealedAt, null, "an owned turn without text keeps waiting");
    history.accept("claude", { token, owned: true, text: "Frozen", generation: null, ended: true }, history.readMark());
    assert.equal(answer().capture, "unknown", "a frozen snapshot has no known freeze time");
  } finally { db.close(); }
});

test("generation seen again after confirmation revokes the evidence", () => {
  const { db, history, token, settle, answer } = fixture();
  try {
    history.result("run-a", { site: "claude", ok: true });
    history.complete("run-a", "claude");
    history.accept("claude", { token, owned: true, text: "More", generation: "generating" }, history.readMark());
    settle("More text");
    assert.equal(answer().sealedAt, null);
    assert.equal(answer().capture, "unknown");
  } finally { db.close(); }
});

test("a false monitor completion cannot seal an answer that is still growing (Yuanbao draft hides Stop)", () => {
  const { db, history, token, advance, answer } = fixture();
  try {
    history.result("run-a", { site: "claude", ok: true });
    history.accept("claude", { token, owned: true, text: "Half", generation: "generating" }, history.readMark());
    // The composer holds a draft: Stop is hidden, the monitor settles, the snapshot reports no generation.
    assert.equal(history.complete("run-a", "claude"), true);
    for (const text of ["Half a sentence", "Half a sentence that", "Half a sentence that keeps going"]) {
      history.accept("claude", { token, owned: true, text, generation: null }, history.readMark());
      assert.equal(answer().sealedAt, null, "growing text vetoes the seal");
      advance(SEAL_QUIET_MS);
    }
    history.accept("claude", { token, owned: true, text: "Half a sentence that keeps going.", generation: null }, history.readMark());
    assert.equal(answer().sealedAt, null);
    advance(SEAL_QUIET_MS);
    history.accept("claude", { token, owned: true, text: "Half a sentence that keeps going.", generation: null }, history.readMark());
    assert.equal(answer().capture, "complete");
    assert.equal(answer().answerMarkdown, "Half a sentence that keeps going.");
  } finally { db.close(); }
});

test("identical reads closer than the quiet window do not seal (tail growth margin)", () => {
  const { db, history, token, advance, answer } = fixture();
  try {
    history.result("run-a", { site: "claude", ok: true });
    history.complete("run-a", "claude");
    history.accept("claude", { token, owned: true, text: "Answer", generation: null }, history.readMark());
    advance(SEAL_QUIET_MS - 1_000);
    history.accept("claude", { token, owned: true, text: "Answer", generation: null }, history.readMark());
    assert.equal(answer().sealedAt, null);
    // The read must START after the window: one issued early and answered late still cannot seal.
    const early = history.readMark();
    advance(2_000);
    history.accept("claude", { token, owned: true, text: "Answer", generation: null }, early);
    assert.equal(answer().sealedAt, null);
    history.accept("claude", { token, owned: true, text: "Answer", generation: null }, history.readMark());
    assert.equal(answer().capture, "complete");
  } finally { db.close(); }
});

test("a retry attempt cannot inherit the previous attempt's confirmation", () => {
  const { db, history, answer } = fixture();
  try {
    history.result("run-a", { site: "claude", ok: true });
    history.begin(request("run-a"));
    assert.equal(history.complete("run-a", "claude"), false, "the new attempt has not been submitted yet");
    history.result("run-a", { site: "claude", ok: true });
    const token = history.token("claude")!;
    history.accept("claude", { token, owned: true, text: "Retry streaming", generation: null }, history.readMark());
    assert.equal(answer().attempt, 2);
    assert.equal(answer().sealedAt, null);
  } finally { db.close(); }
});

test("capture service reads right after confirmation, re-reads after an in-flight poll and seals after the quiet window", async () => {
  const { db, history, token, advance, answer } = fixture();
  history.result("run-a", { site: "claude", ok: true });
  let release!: (s: HistorySnapshot) => void;
  const reads: string[] = [];
  const capture = new QuestionCaptureService(history, async () => {
    reads.push("read");
    if (reads.length === 1) return new Promise<HistorySnapshot>(done => { release = done; });
    return { token, owned: true, text: "Fresh final answer", generation: null };
  });
  try {
    const first = capture.tick();
    capture.complete("run-a", "claude");
    release({ token, owned: true, text: "Text read before confirmation", generation: null });
    await first;
    for (let i = 0; i < 5 && reads.length < 2; i++) await new Promise(resolve => setImmediate(resolve));
    assert.equal(reads.length, 2, "the confirmation schedules an immediate second read");
    for (let i = 0; i < 5 && answer().answerMarkdown !== "Fresh final answer"; i++) await new Promise(resolve => setImmediate(resolve));
    assert.equal(answer().sealedAt, null, "the immediate read is only a candidate");
    for (let i = 0; i < 5; i++) await new Promise(resolve => setImmediate(resolve));
    advance(SEAL_QUIET_MS);
    await capture.tick();
    assert.equal(reads.length, 3);
    assert.equal(answer().capture, "complete");
    assert.equal(answer().answerMarkdown, "Fresh final answer");
  } finally { capture.dispose(); db.close(); }
});

test("generation monitor reports each site's settled completion once and binding forwards it", () => {
  const monitor = new GenerationMonitor();
  const calls: string[] = [];
  monitor.onComplete = (runId, site) => calls.push(`${runId}:${site}`);
  monitor.begin("run-a", ["claude"]);
  monitor.accept("run-a", "claude", "complete");
  monitor.accept("run-a", "claude", "complete_observed");
  monitor.accept("run-a", "claude", "complete");
  monitor.accept("run-a", "claude", "complete");
  monitor.accept("run-a", "claude", "complete");
  assert.deepEqual(calls, ["run-a:claude"]);
  monitor.onComplete = () => { throw new Error("history failure"); };
  monitor.begin("run-b", ["claude"]);
  for (const state of ["generating", "complete", "complete", "complete"] as const) monitor.accept("run-b", "claude", state);
  assert.equal(monitor.accept("run-b", "claude", "complete"), "complete");

  let forwarded!: (runId: string, site: SiteKey) => void;
  const confirmed: string[] = [];
  const history = { token: () => undefined, releasable: () => false, clearReleaseEvidence() {}, cancel() {}, targets: () => [], setSubmissionHandler() {},
    complete: (runId: string, site: SiteKey) => { confirmed.push(`${runId}:${site}`); return false; } } as unknown as QuestionHistoryService;
  const manager = { setCapturePending() {}, onGenerationComplete: (listener: typeof forwarded) => { forwarded = listener; } } as unknown as ViewManager;
  const capture = createQuestionCapture(history, manager);
  try { forwarded("run-a", "claude"); assert.deepEqual(confirmed, ["run-a:claude"]); } finally { capture.dispose(); }
});

test("capture service re-reads a seal candidate after the quiet window instead of the 5s poll", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { db, history, token, advance, answer } = fixture();
  history.result("run-a", { site: "claude", ok: true });
  let reads = 0;
  const capture = new QuestionCaptureService(history, async () => { reads++; return { token, owned: true, text: "Done", generation: null }; });
  const settle = async () => { for (let i = 0; i < 10; i++) await new Promise(resolve => setImmediate(resolve)); };
  try {
    capture.complete("run-a", "claude");
    await settle();
    assert.equal(reads, 1);
    assert.equal(answer().sealedAt, null);
    advance(SEAL_QUIET_MS);
    t.mock.timers.tick(SEAL_QUIET_MS + 100);
    await settle();
    assert.equal(reads, 2, "the re-read is scheduled by the quiet window, well before the 5s poll");
    assert.equal(answer().capture, "complete");
  } finally { capture.dispose(); db.close(); }
});
