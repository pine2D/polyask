import assert from "node:assert/strict";
import test from "node:test";
import { DesktopDatabase } from "../src/main/database";
import { QuestionHistoryService, SEAL_QUIET_MS } from "../src/main/question-history-service";
import { QuestionCaptureService } from "../src/main/question-capture-service";
import { sessionHandoff } from "../src/main/question-capture-binding";
import { WorkspaceService } from "../src/main/workspace-service";
import { ArchiveService } from "../src/main/archive-service";
import { SynthesisService } from "../src/main/synthesis-service";
import { SITES } from "../src/main/sites";

// 2026-10-10 审查 R8：新会话、辅助综合导航前没有先读完在采的站，刚完成的回答丢掉尾部并被记为中断（B06 残留）。
const request = (runId: string) => ({ runId, sites: ["claude"] as const, text: runId, tier: null, images: [] });
const drain = async () => { for (let i = 0; i < 8; i++) await new Promise(resolve => setImmediate(resolve)); };

function capturing() {
  const db = DesktopDatabase.open(":memory:");
  const history = new QuestionHistoryService(db.questions, { deviceId: () => "local" });
  let text = "Partial", generation: "generating" | null = "generating";
  const capture = new QuestionCaptureService(history, async (_site, token) => ({ token, owned: true, text, generation }));
  const question = history.begin(request("first"))!;
  history.result("first", { site: "claude", ok: true });
  return { db, history, capture, question, finish(value: string) { text = value; generation = null; } };
}

test("a new session reads the confirmed answer to its end before navigating away", async t => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 1000 });
  const h = capturing();
  const seen: { markdown: string | null; capture: string }[] = [];
  const workspace = new WorkspaceService(h.db.state, h.db.meta, () => {
    const answer = h.db.questions.answers(h.question.id)[0];
    seen.push({ markdown: answer.answerMarkdown, capture: answer.capture });
  });
  try {
    await h.capture.tick();
    assert.equal(h.db.questions.answers(h.question.id)[0].answerMarkdown, "Partial");
    h.finish("Partial and the final tail");
    h.history.complete("first", "claude");
    workspace.setBeforeNewSession(sessionHandoff(h.history, h.capture));
    const opening = workspace.newSession(["claude"]);
    await drain();
    assert.deepEqual(seen, [], "navigation waits for the bounded handoff");
    t.mock.timers.tick(SEAL_QUIET_MS + 100);
    await drain();
    assert.deepEqual(await opening, [{ site: "claude", ok: true }]);
    assert.deepEqual(seen, [{ markdown: "Partial and the final tail", capture: "complete" }]);
    assert.equal(h.history.token("claude"), undefined, "the old session's capture ends with the navigation");
  } finally { h.capture.dispose(); h.db.close(); }
});

test("an unconfirmed answer is saved, then interrupted, without delaying the new session", async () => {
  const h = capturing();
  const order: string[] = [];
  const workspace = new WorkspaceService(h.db.state, h.db.meta, () => { order.push("navigate"); });
  try {
    h.finish("Answer still streaming tail");
    workspace.setBeforeNewSession(async sites => { order.push("handoff"); await sessionHandoff(h.history, h.capture)(sites); });
    await workspace.newSession(["claude"]);
    assert.deepEqual(order, ["handoff", "navigate"]);
    const answer = h.db.questions.answers(h.question.id)[0];
    assert.equal(answer.answerMarkdown, "Answer still streaming tail");
    assert.equal(answer.capture, "interrupted");
  } finally { h.capture.dispose(); h.db.close(); }
});

test("a failing handoff never blocks the new session", async () => {
  const h = capturing();
  const navigations: string[] = [];
  const workspace = new WorkspaceService(h.db.state, h.db.meta, site => { navigations.push(site); });
  try {
    workspace.setBeforeNewSession(async () => { throw new Error("storage"); });
    assert.deepEqual(await workspace.newSession(["claude"]), [{ site: "claude", ok: true }]);
    assert.deepEqual(navigations, ["claude"]);
  } finally { h.capture.dispose(); h.db.close(); }
});

function synthesisFixture(beforeNavigate: (site: string) => Promise<void>, events: string[]) {
  const database = DesktopDatabase.open(":memory:");
  const archives = new ArchiveService(database.archives, { deviceId: () => "device-a", createId: () => "archive-a" });
  const record = archives.add({ text: "Question", task: "Question",
    results: [{ host: "claude.ai", label: "Claude", text: "One" }, { host: "chatgpt.com", label: "ChatGPT", text: "Two" }] });
  const service = new SynthesisService({
    sites: SITES, archives, navigate: async site => { events.push(`navigate:${site}`); },
    send: async () => { events.push("send"); return [{ site: "claude", ok: true }]; },
    collect: async () => [], showTarget: () => undefined, recordHistory: () => undefined
  });
  service.setBeforeNavigate(async site => { events.push(`handoff:${site}`); await beforeNavigate(site); });
  const send = () => service.send({ archiveId: record.id, targetSite: "claude", tier: "fast", selectedHosts: ["claude.ai", "chatgpt.com"], instruction: "Summarize" });
  return { database, service, send };
}

test("assisted synthesis hands off the target site's capture before navigating it", async () => {
  const events: string[] = [];
  const f = synthesisFixture(async () => undefined, events);
  try {
    assert.equal((await f.send()).result.ok, true);
    assert.deepEqual(events, ["handoff:claude", "navigate:claude", "send"]);
  } finally { f.database.close(); }
});

test("cancelling synthesis during the handoff neither navigates nor sends", async () => {
  const events: string[] = [];
  let release!: () => void;
  const f = synthesisFixture(() => new Promise<void>(resolve => { release = resolve; }), events);
  try {
    const sending = f.send();
    await drain();
    f.service.cancel();
    release();
    const response = await sending;
    assert.equal(response.result.ok, false);
    assert.equal(response.result.code, "cancelled");
    assert.deepEqual(events, ["handoff:claude"]);
  } finally { f.database.close(); }
});
