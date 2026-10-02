import assert from "node:assert/strict";
import test from "node:test";
import { DesktopDatabase } from "../src/main/database";
import { QuestionHistoryService } from "../src/main/question-history-service";
import { QuestionCaptureService } from "../src/main/question-capture-service";
import type { HistorySnapshot } from "../src/shared/question-capture";

function deferredSnapshot() {
  let resolve!: (snapshot: HistorySnapshot) => void;
  const promise = new Promise<HistorySnapshot>(done => { resolve = done; });
  return { promise, resolve };
}

function fixture() {
  const db = DesktopDatabase.open(":memory:");
  const history = new QuestionHistoryService(db.questions, { deviceId: () => "test-device" });
  const q = history.begin({ runId: "test-run", sites: ["claude"], text: "Synthetic question", tier: null, images: [] })!;
  history.result("test-run", { site: "claude", ok: true });
  return { db, history, q, token: history.token("claude")! };
}

test("navigation flush waits for the active capture before the caller seals the answer", async () => {
  const { db, history, q, token } = fixture();
  const pending = deferredSnapshot();
  let reads = 0;
  const capture = new QuestionCaptureService(history, async () => { reads++; return pending.promise; });
  try {
    const tick = capture.tick();
    let flushed = false;
    const flush = capture.flush(["claude"]).then(() => { flushed = true; history.cancel(["claude"]); });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(flushed, false, "flush must not seal the record while its read is pending");
    pending.resolve({ token, owned: true, text: "Final captured text" });
    await Promise.all([tick, flush]);
    assert.equal(db.questions.answers(q.id)[0].answerMarkdown, "Final captured text");
    assert.equal(reads, 1, "joining a capture must not start an overlapping probe");
  } finally { capture.dispose(); pending.resolve({ token, owned: false }); db.close(); }
});

test("starting another broadcast preserves an in-flight final snapshot before changing its token", async () => {
  const { db, history, q, token } = fixture();
  const pending = deferredSnapshot();
  const capture = new QuestionCaptureService(history, () => pending.promise);
  const request = { runId: "next", sites: ["claude" as const], text: "Next synthetic question", tier: null, images: [] };
  try {
    const tick = capture.tick();
    const preparing = capture.prepareRun(request, 44_000);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(history.token("claude"), token);
    pending.resolve({ token, owned: true, text: "Final captured text" });
    const remaining = await preparing;
    await tick;
    assert.equal(db.questions.answers(q.id)[0].answerMarkdown, "Final captured text");
    assert.notEqual(history.token("claude"), token);
    assert.ok(remaining > 0 && remaining <= 44_000);
  } finally { capture.dispose(); pending.resolve({ token, owned: false }); db.close(); }
});

test("local reset during the final flush prevents a late broadcast from starting", async () => {
  const { db, history, token } = fixture();
  const pending = deferredSnapshot();
  const capture = new QuestionCaptureService(history, () => pending.promise);
  try {
    const tick = capture.tick();
    const preparing = capture.prepareRun({ runId: "after-reset", sites: ["claude"],
      text: "Should not be sent", tier: null, images: [] }, 44_000);
    await new Promise(resolve => setImmediate(resolve));
    db.questions.invalidateLifecycle();
    pending.resolve({ token, owned: false });
    await assert.rejects(preparing, /cancelled/);
    await tick;
    assert.equal(db.questions.search().items.length, 1);
  } finally { capture.dispose(); pending.resolve({ token, owned: false }); db.close(); }
});

test("navigation flush is bounded even if an active reader never settles", async t => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1000 });
  const { db, history } = fixture();
  const capture = new QuestionCaptureService(history, () => new Promise(() => {}));
  try {
    void capture.tick();
    let flushed = false;
    const flush = capture.flush(["claude"]).then(() => { flushed = true; });
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    assert.equal(flushed, false);
    t.mock.timers.tick(2499);
    await Promise.resolve();
    assert.equal(flushed, false);
    t.mock.timers.tick(1);
    await flush;
    assert.equal(flushed, true);
  } finally { capture.dispose(); db.close(); }
});

test("disposing an in-flight capture rejects its late body and does not restart polling", async () => {
  const { db, history, q, token } = fixture();
  const pending = deferredSnapshot();
  const capture = new QuestionCaptureService(history, () => pending.promise);
  try {
    const tick = capture.tick();
    capture.dispose();
    pending.resolve({ token, owned: true, text: "Late text" });
    await tick;
    assert.equal(db.questions.answers(q.id)[0].answerMarkdown, null);
    assert.deepEqual(history.targets(), []);
  } finally { capture.dispose(); db.close(); }
});

test("flush captures a new token introduced while the previous poll is pending", async () => {
  const { db, history, token } = fixture();
  const pending = deferredSnapshot();
  let reads = 0;
  const capture = new QuestionCaptureService(history, async (_site, currentToken) => {
    if (++reads === 1) return pending.promise;
    return { token: currentToken, owned: true, text: "New turn final text" };
  });
  try {
    const tick = capture.tick();
    const next = history.begin({ runId: "next", sites: ["claude"], text: "Next synthetic question", tier: null, images: [] })!;
    history.result("next", { site: "claude", ok: true });
    const flush = capture.flush(["claude"]);
    pending.resolve({ token, owned: true, text: "Old turn late text" });
    await Promise.all([tick, flush]);
    history.cancel(["claude"]);
    assert.equal(db.questions.answers(next.id)[0].answerMarkdown, "New turn final text");
  } finally { capture.dispose(); pending.resolve({ token, owned: false }); db.close(); }
});

test("reclamation notification observes the persisted final answer", async () => {
  const { db, history, q, token } = fixture();
  let checks = 0;
  const capture = new QuestionCaptureService(history,
    async () => ({ token, owned: true, text: "Final answer", generation: "complete" }),
    () => {
      checks++;
      if (!history.token("claude")) {
        const answer = db.questions.answers(q.id)[0];
        assert.equal(answer.answerMarkdown, "Final answer");
        assert.equal(answer.capture, "complete");
        assert.notEqual(answer.sealedAt, null);
      }
    });
  try {
    for (let i = 0; i < 4; i++) await capture.tick();
    assert.equal(checks, 4);
    assert.equal(history.token("claude"), undefined);
  } finally { capture.dispose(); db.close(); }
});

test("disposed capture does not request reclamation from a late result", async () => {
  const { db, history, token } = fixture();
  const pending = deferredSnapshot();
  let checks = 0;
  const capture = new QuestionCaptureService(history, () => pending.promise, () => { checks++; });
  try {
    const tick = capture.tick();
    capture.dispose();
    pending.resolve({ token, owned: true, text: "Late answer" });
    await tick;
    assert.equal(checks, 0);
  } finally { capture.dispose(); db.close(); }
});

test("unknown completion stays protected until the existing capture budget seals the saved body", async t => {
  t.mock.timers.enable({ apis: ["Date"], now: 1000 });
  const { db, history, q, token } = fixture();
  let generating = true;
  const sealed: boolean[] = [];
  const capture = new QuestionCaptureService(history,
    async () => ({ token, owned: true, text: "Safely attributed answer", generation: generating ? "generating" : null }),
    () => { sealed.push(!history.token("claude")); });
  try {
    await capture.tick();
    generating = false;
    t.mock.timers.setTime(60_000);
    await capture.tick();
    assert.equal(history.token("claude"), token, "quiet text is not positive completion evidence");
    assert.deepEqual(sealed, [false, false]);
    t.mock.timers.setTime(901_010);
    await capture.tick();
    const answer = db.questions.answers(q.id)[0];
    assert.equal(answer.answerMarkdown, "Safely attributed answer");
    assert.equal(answer.capture, "unknown");
    assert.notEqual(answer.sealedAt, null);
    assert.deepEqual(sealed, [false, false, true]);
  } finally { capture.dispose(); db.close(); }
});
