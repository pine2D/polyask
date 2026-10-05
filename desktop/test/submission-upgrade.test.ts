import assert from "node:assert/strict";
import test from "node:test";
import { BroadcastCoordinator } from "../src/main/broadcast";
import { acceptBroadcastResult } from "../src/main/broadcast-result";
import { DesktopDatabase } from "../src/main/database";
import { createQuestionCapture } from "../src/main/question-capture-binding";
import { QuestionHistoryService, SEAL_QUIET_MS } from "../src/main/question-history-service";
import { statusForResult, statusForSending } from "../src/main/status";
import { cancelSubmissions, lateSentResult, upgradeSubmission, upgradedSubmissionStatus } from "../src/main/submission-upgrade";
import { QuestionCaptureService } from "../src/main/question-capture-service";
import { GenerationMonitor } from "../src/main/generation-monitor";
import type { ViewManager } from "../src/main/view-manager";
import type { SiteKey } from "../src/shared/contracts";
import type { SiteStatus } from "../src/shared/protocol";
import type { HistorySnapshot } from "../src/shared/question-capture";
import { acceptLateSubmission, completeRun, failedRunSites, retryRequest } from "../src/renderer/broadcast-run";
import { BroadcastFlowState } from "../src/renderer/broadcast-flow-state";
import { readSource } from "./fixtures";

// 迟到确认：站点先回 submit_unconfirmed，之后归属快照（非锚点）证明本轮用户消息已在页面上 → 只升为已发送，绝不重发。

const request = (runId = "run") => ({ runId, sites: ["claude"] as SiteKey[], text: "Question", tier: null, images: [] });

function fixture(result: { ok: boolean; code?: string; selection?: unknown } = { ok: false, code: "submit_unconfirmed" }) {
  const db = DesktopDatabase.open(":memory:");
  let now = 1000;
  const history = new QuestionHistoryService(db.questions, { deviceId: () => "local", now: () => ++now });
  const upgrades: string[] = [];
  history.setSubmissionHandler((runId, site) => { upgrades.push(`${runId}:${site}`); });
  const q = history.begin(request())!;
  const token = history.token("claude")!;
  history.result("run", { site: "claude", ...result } as never);
  const accept = (value: Partial<HistorySnapshot>, site: SiteKey = "claude") =>
    history.accept(site, { token, owned: true, ...value } as HistorySnapshot, history.readMark());
  return { db, history, q, token, upgrades, accept, advance: (ms: number) => { now += ms; },
    answers: () => db.questions.answers(q.id).filter(a => a.site === "claude").sort((a, b) => a.attempt - b.attempt) };
}

for (const locate of ["selector", "semantic"] as const) {
  test(`an unconfirmed attempt is upgraded once by a ${locate}-located owned snapshot`, () => {
    const s = fixture();
    try {
      assert.equal(s.answers()[0].submission, "unconfirmed");
      s.accept({ locate, text: null, generation: "generating" });
      const answer = s.answers()[0];
      assert.equal(answer.submission, "submitted");
      assert.equal(answer.submissionCode, null);
      assert.equal(answer.capture, "waiting");
      assert.deepEqual(s.upgrades, ["run:claude"]);
      assert.equal(s.history.token("claude"), s.token, "observation continues after the upgrade");
      s.accept({ locate, text: "Partial", generation: "generating" });
      assert.deepEqual(s.upgrades, ["run:claude"], "the upgrade fires only once");
      assert.equal(s.answers()[0].answerMarkdown, "Partial");
    } finally { s.db.close(); }
  });
}

test("negative evidence never upgrades: anchor, unowned, unlabelled, ended or foreign-token snapshots", () => {
  const cases: [string, Partial<HistorySnapshot>][] = [
    ["anchor", { locate: "anchor", text: "Answer" }],
    ["unowned", { owned: false, locate: "selector" }],
    ["no locate", { text: "Answer" }],
    ["ended", { locate: "selector", text: "Answer", ended: true }],
    ["foreign token", { token: "other-token", locate: "selector", text: "Answer" }]
  ];
  for (const [label, snapshot] of cases) {
    const s = fixture();
    try {
      s.accept(snapshot);
      assert.equal(s.answers()[0].submission, "unconfirmed", label);
      assert.equal(s.answers()[0].submissionCode, "submit_unconfirmed", label);
      assert.deepEqual(s.upgrades, [], label);
    } finally { s.db.close(); }
  }
});

test("only unconfirmed attempts are upgraded, and never after the observation budget", () => {
  const sent = fixture({ ok: true });
  try {
    sent.accept({ locate: "selector", text: "Answer" });
    assert.equal(sent.answers()[0].submission, "submitted");
    assert.deepEqual(sent.upgrades, [], "an already-sent attempt is not reported again");
  } finally { sent.db.close(); }
  const failed = fixture({ ok: false, code: "timeout" });
  try {
    failed.accept({ locate: "selector", text: "Answer" });
    assert.equal(failed.answers()[0].submission, "failed");
    assert.deepEqual(failed.upgrades, []);
  } finally { failed.db.close(); }
  const late = fixture();
  try {
    late.advance(15 * 60_000 + 10);
    late.accept({ locate: "selector", text: "Answer" });
    assert.equal(late.answers()[0].submission, "unconfirmed");
    assert.deepEqual(late.upgrades, []);
  } finally { late.db.close(); }
});

test("cancel, delete and a same-runId retry retire the old attempt's evidence", () => {
  // 生产取消路径：polyask:cancel 只取消 sending 的站；已回包 submit_unconfirmed 的站（phase failed）必须靠 cancelSubmissions 作废迟到确认。
  const cancelled = fixture();
  try {
    const statuses = [statusForResult("claude", { ok: false, code: "submit_unconfirmed" }, "run"), statusForSending("kimi", "run")];
    assert.deepEqual(cancelSubmissions(statuses, cancelled.history), ["kimi"], "only the sending site is cancelled");
    assert.equal(cancelled.history.token("claude"), cancelled.token, "the unconfirmed site keeps capturing");
    cancelled.accept({ locate: "selector", text: "Answer" });
    assert.equal(cancelled.answers()[0].submission, "unconfirmed");
    assert.equal(cancelled.answers()[0].answerMarkdown, "Answer");
    assert.deepEqual(cancelled.upgrades, []);
  } finally { cancelled.db.close(); }
  const deleted = fixture();
  try {
    deleted.history.delete(deleted.q.id);
    deleted.accept({ locate: "selector", text: "Answer" });
    assert.deepEqual(deleted.upgrades, []);
  } finally { deleted.db.close(); }
  const retried = fixture();
  try {
    retried.history.begin(request());
    const fresh = retried.history.token("claude")!;
    assert.notEqual(fresh, retried.token);
    retried.accept({ locate: "selector", text: "Stale" });
    assert.deepEqual(retried.upgrades, [], "a snapshot for the superseded attempt is dropped");
    retried.history.accept("claude", { token: fresh, owned: true, locate: "selector" }, retried.history.readMark());
    assert.deepEqual(retried.upgrades, [], "the retry is still pending its own result");
    retried.history.result("run", { site: "claude", ok: false, code: "submit_unconfirmed" });
    retried.history.accept("claude", { token: fresh, owned: true, locate: "selector" }, retried.history.readMark());
    assert.deepEqual(retried.upgrades, ["run:claude"]);
    assert.deepEqual(retried.answers().map(a => a.submission), ["unconfirmed", "submitted"], "only the current attempt is upgraded");
  } finally { retried.db.close(); }
});

test("an upgraded attempt seals as complete once the generation monitor confirms it", () => {
  const s = fixture();
  try {
    s.accept({ locate: "selector", text: null, generation: "generating" });
    assert.equal(s.history.complete("run", "claude"), true);
    s.accept({ locate: "selector", text: "Final", generation: null });
    s.advance(SEAL_QUIET_MS);
    s.accept({ locate: "selector", text: "Final", generation: null });
    assert.equal(s.answers()[0].capture, "complete");
    assert.equal(s.answers()[0].submission, "submitted");
  } finally { s.db.close(); }
});

const selection = { requested: "think", outcome: "mode_only", observed: "think" } as const;
const unconfirmed = (runId = "run"): SiteStatus => statusForResult("claude", { ok: false, code: "submit_unconfirmed", selection }, runId);

test("the shell status is upgraded only while it still shows this run as unconfirmed", () => {
  const upgraded = upgradedSubmissionStatus(unconfirmed(), "run");
  assert.deepEqual(upgraded, { site: "claude", phase: "submitted", selection, submissionEvidence: "message",
    submission: { runId: "run", state: "sent", selection, submissionEvidence: "message" } });
  assert.equal(upgraded && "code" in upgraded, false);
  assert.equal(upgradedSubmissionStatus(unconfirmed("older"), "run"), null, "another run");
  assert.equal(upgradedSubmissionStatus(statusForSending("claude", "run"), "run"), null, "user already retried");
  assert.equal(upgradedSubmissionStatus(statusForResult("claude", { ok: false, code: "cancelled" }, "run"), "run"), null, "cancelled");
  assert.equal(upgradedSubmissionStatus(statusForResult("claude", { ok: true }, "run"), "run"), null, "never re-upgrade or downgrade");
  assert.equal(upgradedSubmissionStatus({ site: "claude", phase: "ready" }, "run"), null, "new run cleared the submission");
  assert.equal(upgradedSubmissionStatus(undefined, "run"), null);
});

function fakeManager(initial: SiteStatus | null, snapshot: () => HistorySnapshot) {
  const statuses = new Map<SiteKey, SiteStatus>(initial ? [[initial.site, initial]] : []);
  const calls = { watch: [] as string[], dispatch: 0, confirm: 0 };
  const manager = {
    getStatuses: () => [...statuses.values()],
    markStatus: (status: SiteStatus) => { statuses.set(status.site, status); },
    watchGeneration: (runId: string, site: SiteKey) => { calls.watch.push(`${runId}:${site}`); },
    sendCommand: async () => { calls.dispatch++; return { ok: true }; },
    confirmSubmitted: async () => { calls.confirm++; return { supported: true, ok: true }; },
    setCapturePending() {}, onGenerationComplete() {}, releaseUnselectedViews() {},
    historyAccess: { snapshot: async () => snapshot() }
  };
  return { manager, statuses, calls };
}

test("the status upgrade marks sent, starts generation watching and never dispatches", () => {
  const fake = fakeManager(unconfirmed(), () => ({ token: "t", owned: false }));
  assert.equal(upgradeSubmission(fake.manager, "run", "claude"), true);
  assert.equal(fake.statuses.get("claude")?.submission?.state, "sent");
  assert.equal(fake.statuses.get("claude")?.phase, "submitted");
  assert.deepEqual(fake.calls.watch, ["run:claude"]);
  assert.equal(upgradeSubmission(fake.manager, "run", "claude"), false, "already sent");
  assert.deepEqual(fake.calls.watch, ["run:claude"]);
  assert.equal(fake.calls.dispatch + fake.calls.confirm, 0);
  const stale = fakeManager(unconfirmed("older"), () => ({ token: "t", owned: false }));
  assert.equal(upgradeSubmission(stale.manager, "run", "claude"), false);
  assert.deepEqual(stale.calls.watch, []);
});

for (const locate of ["selector", "anchor"] as const) {
  test(`end to end: submit_unconfirmed then a ${locate} capture ${locate === "selector" ? "upgrades" : "stays unconfirmed"} with exactly one dispatch`, async () => {
    const db = DesktopDatabase.open(":memory:");
    const history = new QuestionHistoryService(db.questions, { deviceId: () => "local" });
    let token = "";
    const fake = fakeManager(null, () => ({ token, owned: true, locate, text: null, generation: "generating" }));
    const capture = createQuestionCapture(history, fake.manager as unknown as ViewManager);
    try {
      const q = history.begin(request())!;
      token = history.token("claude")!;
      fake.manager.markStatus(statusForSending("claude", "run"));
      let dispatches = 0, probes = 0;
      const results = await new BroadcastCoordinator().send(request(),
        async () => { dispatches++; return { ok: false, code: "submit_unconfirmed" }; }, 44_000,
        result => acceptBroadcastResult(db.questions.lifecycle, "run", result, history, capture, fake.manager as unknown as ViewManager),
        { confirm: async () => { probes++; return { supported: false, ok: false }; }, resubmit: false });
      assert.equal(results[0].code, "submit_unconfirmed");
      assert.equal(fake.statuses.get("claude")?.submission?.state, "unconfirmed");
      assert.deepEqual(fake.calls.watch, [], "an unconfirmed result is not watched on its own");
      await capture.tick();
      const answer = db.questions.answers(q.id)[0];
      if (locate === "selector") {
        assert.equal(answer.submission, "submitted");
        assert.equal(fake.statuses.get("claude")?.submission?.state, "sent");
        assert.equal(fake.statuses.get("claude")?.code, undefined);
        assert.deepEqual(fake.calls.watch, ["run:claude"]);
      } else {
        assert.equal(answer.submission, "unconfirmed");
        assert.equal(fake.statuses.get("claude")?.code, "submit_unconfirmed");
        assert.deepEqual(fake.calls.watch, []);
      }
      assert.equal(dispatches, 1, "the upgrade path never resends");
      assert.equal(probes, 1);
      assert.equal(fake.calls.dispatch + fake.calls.confirm, 0, "no sendCommand / confirmSubmitted from the upgrade path");
    } finally { capture.dispose(); db.close(); }
  });
}

const tierUnconfirmed = { requested: "think", outcome: "unconfirmed" } as const;

test("a tier-unconfirmed attempt keeps tier_unconfirmed through the upgrade (record, shell status, renderer)", () => {
  const s = fixture({ ok: false, code: "submit_unconfirmed", selection: tierUnconfirmed });
  try {
    s.accept({ locate: "selector", text: null });
    assert.equal(s.answers()[0].submission, "submitted");
    assert.equal(s.answers()[0].submissionCode, "tier_unconfirmed", "same code the normal success path stores");
  } finally { s.db.close(); }
  const previous = statusForResult("claude", { ok: false, code: "submit_unconfirmed", selection: tierUnconfirmed }, "run");
  const normal = statusForResult("claude", { ok: true, code: "tier_unconfirmed", selection: tierUnconfirmed }, "run");
  const upgraded = upgradedSubmissionStatus(previous, "run")!;
  assert.equal(upgraded.phase, "warning");
  assert.equal(upgraded.code, "tier_unconfirmed");
  assert.equal(upgraded.phase, normal.phase);
  assert.equal(upgraded.submission?.code, "tier_unconfirmed");
  assert.equal(upgraded.submission?.state, "sent");
  const late = acceptLateSubmission(completeRun(request(), [{ site: "claude", ok: false, code: "submit_unconfirmed", selection: tierUnconfirmed }]), "claude", "run");
  assert.deepEqual(late.results.get("claude"), { site: "claude", ok: true, selection: tierUnconfirmed, submissionEvidence: "message", code: "tier_unconfirmed" });
});

test("a same-runId retry whose capture flush upgrades the site never dispatches it again", async () => {
  const db = DesktopDatabase.open(":memory:");
  const history = new QuestionHistoryService(db.questions, { deviceId: () => "local" });
  let reads = 0;
  const fake = fakeManager(null, () => ({ token: "", owned: false }));
  const capture = new QuestionCaptureService(history, async (_site, token) => { reads++; return { token, owned: true, locate: "selector", text: null, generation: "generating" }; });
  history.setSubmissionHandler((runId, site) => { upgradeSubmission(fake.manager, runId, site); });
  const phases: string[] = [];
  const markStatus = fake.manager.markStatus;
  fake.manager.markStatus = (status: SiteStatus) => { phases.push(status.phase); markStatus(status); };
  try {
    const q = history.begin(request())!;
    const token = history.token("claude")!;
    history.result("run", { site: "claude", ok: false, code: "submit_unconfirmed" });
    fake.manager.markStatus(statusForResult("claude", { ok: false, code: "submit_unconfirmed" }, "run"));
    // 渲染层还显示重试，用户点「重试 Claude」：主进程按 shell-ipc.ts 的顺序 prepareRun → 只对 dispatch 开监视、标发送中、派发。
    const { dispatch, settled } = await capture.prepareRun(request(), 44_000, lateSentResult(fake.manager, "run"));
    assert.ok(reads >= 1, "the retry's flush read the old attempt");
    assert.deepEqual(dispatch.sites, [], "the upgraded site is removed from the retry");
    assert.deepEqual(settled, [{ site: "claude", ok: true, submissionEvidence: "message" }]);
    for (const site of dispatch.sites) fake.manager.markStatus(statusForSending(site, "run"));
    let dispatches = 0;
    const results = await new BroadcastCoordinator().send(dispatch, async () => { dispatches++; return { ok: true }; }, 44_000);
    assert.equal(dispatches, 0, "a site with positive evidence is never asked twice");
    assert.deepEqual([...settled, ...results].map(r => [r.site, r.ok]), [["claude", true]]);
    assert.equal(history.token("claude"), token, "no new attempt replaced the upgraded one");
    assert.deepEqual(db.questions.answers(q.id).map(a => [a.attempt, a.submission]), [[1, "submitted"]]);
    assert.deepEqual(fake.calls.watch, ["run:claude"]);
    assert.deepEqual(phases, ["failed", "submitted"], "never back to sending, generating or warning");
    assert.equal(fake.calls.dispatch + fake.calls.confirm, 0);
  } finally { capture.dispose(); db.close(); }
});

test("a retry whose flush finds no evidence still resends only through the normal user-retry path", async () => {
  const db = DesktopDatabase.open(":memory:");
  const history = new QuestionHistoryService(db.questions, { deviceId: () => "local" });
  const fake = fakeManager(null, () => ({ token: "", owned: false }));
  const capture = new QuestionCaptureService(history, async (_site, token) => ({ token, owned: true, locate: "anchor", text: "Echo" }));
  history.setSubmissionHandler((runId, site) => { upgradeSubmission(fake.manager, runId, site); });
  try {
    history.begin(request());
    const token = history.token("claude")!;
    history.result("run", { site: "claude", ok: false, code: "submit_unconfirmed" });
    fake.manager.markStatus(statusForResult("claude", { ok: false, code: "submit_unconfirmed" }, "run"));
    const { dispatch, settled } = await capture.prepareRun(request(), 44_000, lateSentResult(fake.manager, "run"));
    assert.deepEqual(dispatch.sites, ["claude"], "anchor evidence is not evidence");
    assert.deepEqual(settled, []);
    assert.notEqual(history.token("claude"), token, "the user's retry opens a new attempt");
    assert.deepEqual(fake.calls.watch, []);
  } finally { capture.dispose(); db.close(); }
});

test("an in-flight generation probe from the upgrade cannot land in a same-runId retry's fresh entry", () => {
  const monitor = new GenerationMonitor();
  monitor.begin("run", ["claude"]);
  const ticket = monitor.ticket("run", "claude")!;
  assert.equal(monitor.holds(ticket, "claude"), true);
  monitor.begin("run", ["claude"]);
  assert.equal(monitor.accepts("run", "claude"), true, "runId alone cannot tell the attempts apart");
  assert.equal(monitor.holds(ticket, "claude"), false, "the old probe's reply is dropped");
  assert.equal(monitor.ticket("other", "claude"), null);
});

const run = (code = "submit_unconfirmed", runId = "run") => completeRun(request(runId),
  [{ site: "claude", ok: false, code, selection }]);

test("renderer: a late sent status removes only an unconfirmed site's retry", () => {
  const upgraded = acceptLateSubmission(run(), "claude", "run");
  assert.deepEqual(upgraded.results.get("claude"), { site: "claude", ok: true, selection, submissionEvidence: "message" });
  assert.equal(retryRequest(upgraded), null);
  assert.deepEqual(failedRunSites(upgraded), []);
  for (const [label, candidate] of [["other failure", run("timeout")], ["other run", run(undefined, "older")]] as const) {
    assert.equal(acceptLateSubmission(candidate, "claude", "run"), candidate, label);
  }
});

test("renderer: late evidence survives the broadcast reply but not a retry or a new run", () => {
  const sent = { runId: "run", state: "sent" } as const;
  const state = new BroadcastFlowState();
  let op = state.begin(true)!;
  assert.equal(state.acceptSubmission("claude", sent), false, "no committed run yet");
  state.commit(op, run());
  state.settle(op);
  assert.equal(state.run?.results.get("claude")?.ok, true, "evidence that beat the IPC reply is applied on commit");

  const later = new BroadcastFlowState();
  op = later.begin(true)!; later.commit(op, run()); later.settle(op);
  assert.equal(later.acceptSubmission("claude", { runId: "run", state: "unconfirmed" }), false);
  assert.equal(later.acceptSubmission("claude", { runId: "older", state: "sent" }), false);
  assert.equal(retryRequest(later.run!)?.sites[0], "claude");
  assert.equal(later.acceptSubmission("claude", sent), true);
  assert.equal(retryRequest(later.run!), null);

  const retry = new BroadcastFlowState();
  op = retry.begin(true)!; retry.acceptSubmission("claude", sent); retry.forgetSent(["claude"]);
  retry.commit(op, run()); retry.settle(op);
  assert.equal(retry.run?.results.get("claude")?.ok, false, "a retried site's old evidence is void");
  op = retry.begin(true)!; retry.acceptSubmission("claude", sent); retry.acceptSubmission("claude", { runId: "run", state: "sending" });
  retry.commit(op, run()); retry.settle(op);
  assert.equal(retry.run?.results.get("claude")?.ok, false, "a later non-sent state voids it too");
  retry.acceptSubmission("claude", sent);
  op = retry.begin(true)!; retry.commit(op, run()); retry.settle(op);
  assert.equal(retry.run?.results.get("claude")?.ok, false, "a new run starts without old evidence");
});

test("the late-confirmation path has no way to send: no dispatch, confirm probe or adapter submitted() hook", () => {
  for (const file of ["src/main/submission-upgrade.ts", "src/main/question-capture-binding.ts"]) {
    assert.doesNotMatch(readSource(file).replace(/\/\/.*$|\/\*[\s\S]*?\*\//gm, ""),
      /sendCommand|confirmSubmitted|dispatch|wasSubmitted|coordinator|\.send\(/, file);
  }
  // Claude 没有、也不能有只读 submitted()：broadcast.ts 的重发闸门按「实现了 submitted()」放行，不分站点。
  assert.doesNotMatch(readSource("src/site-runtime/adapters-intl.js"), /submitted\s*\(/);
});
