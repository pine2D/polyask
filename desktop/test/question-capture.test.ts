import assert from "node:assert/strict";
import test from "node:test";
import { DesktopDatabase } from "../src/main/database";
import { QuestionHistoryService } from "../src/main/question-history-service";

const request = (runId: string, sites = ["claude"] as const) => ({ runId, sites, text: "Question", tier: null, images: [] });
test("each send records once, retries append attempts and different sends preserve prior snapshots", () => {
  const db = DesktopDatabase.open(":memory:");
  let now = 10, id = 0;
  const history = new QuestionHistoryService(db.questions, { deviceId: () => "local", now: () => ++now, createId: () => `q-${++id}` });
  try {
    const first = history.begin(request("run-a"))!;
    history.begin(request("run-a"));
    assert.equal(db.questions.search().items.length, 1);
    assert.deepEqual(db.questions.answers(first.id).map(a => a.attempt), [1, 2]);
    history.begin(request("run-b"));
    assert.equal(db.questions.search().items.length, 2);
  } finally { db.close(); }
});
test("only current token snapshots persist and deletion prevents late capture resurrection", () => {
  const db = DesktopDatabase.open(":memory:");
  let now = 10;
  const history = new QuestionHistoryService(db.questions, { deviceId: () => "local", now: () => ++now });
  try {
    const q = history.begin(request("run-a"))!;
    const token = history.token("claude")!;
    history.result("run-a", { site: "claude", ok: true });
    history.accept("claude", { token: "old", owned: true, text: "Wrong", url: null, generation: "generating" });
    assert.equal(db.questions.answers(q.id)[0].answerMarkdown, null);
    history.accept("claude", { token, owned: true, text: "Partial", url: null, generation: "generating" });
    assert.equal(db.questions.answers(q.id)[0].answerMarkdown, "Partial");
    history.cancel(["claude"]);
    history.accept("claude", { token, owned: true, text: "Late", url: null, generation: "complete" });
    assert.equal(db.questions.answers(q.id)[0].answerMarkdown, "Partial");
    db.questions.delete(q.id, 100, "local");
    history.accept("claude", { token, owned: true, text: "Resurrect", url: null, generation: "complete" });
    assert.deepEqual(db.questions.answers(q.id), []);
  } finally { db.close(); }
});
test("history database failures report separately without throwing into the sending chain", () => {
  const db = DesktopDatabase.open(":memory:");
  let failures = 0;
  const history = new QuestionHistoryService(db.questions, { deviceId: () => "local", onFailure: () => failures++ });
  db.close();
  assert.equal(history.begin(request("run-a")), null);
  assert.equal(failures, 1);
});
test('a pre-reset token cannot write after the same IDs are imported again', () => {
  const db = DesktopDatabase.open(':memory:');
  const history = new QuestionHistoryService(db.questions, { deviceId: () => 'local' });
  try {
    const q = history.begin(request('run-reset'))!; history.result('run-reset', { site: 'claude', ok: true });
    const token = history.token('claude')!, a = db.questions.answers(q.id)[0];
    db.resetLocalData(); db.questions.put(q, false); db.questions.putAnswer(a, false);
    history.accept('claude', { token, owned: true, text: 'Late pre-reset answer' });
    assert.equal(db.questions.answers(q.id)[0].answerMarkdown, null);
  } finally { db.close(); }
});
