import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { DesktopDatabase } from "../src/main/database";

const question = (id = "q-a", createdAt = 10) => ({
  schema: 4 as const, id, text: "相同提问", createdAt, updatedAt: createdAt,
  deviceId: "device-a", sites: ["claude" as const], requestedTier: null, inputImageCount: 0
});
const answer = (attempt = 1, questionId = "q-a") => ({
  schema: 4 as const, id: createHash("sha256").update(JSON.stringify([questionId, "claude", attempt])).digest("hex"),
  questionId, site: "claude" as const, attempt, createdAt: 10, updatedAt: 10, deviceId: "device-a",
  submission: "submitted" as const, submissionCode: null, conversationUrl: null,
  answerMarkdown: "已保存回答", capture: "unknown" as const, captureCode: null,
  capturedAt: 10, truncated: false, sealedAt: null
});

test("question history retains repeated prompts and paginates by creation rather than update time", () => {
  const db = DesktopDatabase.open(":memory:");
  try {
    assert.ok(db.questions, "per-send question repository must exist");
    db.questions.put(question());
    db.questions.put(question("q-b", 20));
    const page = db.questions.search({ limit: 1, query: "相同" });
    assert.deepEqual(page.items.map(item => item.id), ["q-b"]);
    assert.ok(page.cursor);
    assert.deepEqual(db.questions.search({ limit: 1, cursor: page.cursor }).items.map(item => item.id), ["q-a"]);
    assert.equal(db.outbox.count(), 2);
  } finally { db.close(); }
});

test("retry answers coexist and parent deletion strips content and blocks late children", () => {
  const db = DesktopDatabase.open(":memory:");
  try {
    db.questions.put(question());
    db.questions.putAnswer(answer());
    db.questions.putAnswer(answer(2));
    assert.deepEqual(db.questions.answers("q-a").map(item => item.attempt), [1, 2]);
    assert.equal(db.questions.delete("q-a", 30, "device-b"), true);
    assert.deepEqual(db.questions.answers("q-a"), []);
    assert.equal("text" in db.questions.get("q-a")!, false);
    assert.equal("answerMarkdown" in db.questions.getAnswer(answer().id)!, false);
    db.questions.putAnswer({ ...answer(3), updatedAt: 40 });
    assert.ok("deletedAt" in db.questions.getAnswer(answer(3).id)!);
    db.questions.put({ ...question(), updatedAt: 50 });
    assert.ok("deletedAt" in db.questions.get("q-a")!);
  } finally { db.close(); }
});

test("orphans wait for their parent and reset removes new data without changing device identity", () => {
  const db = DesktopDatabase.open(":memory:");
  try {
    db.meta.put("deviceId", "device-a");
    db.questions.putAnswer(answer(), false);
    assert.deepEqual(db.questions.answers("q-a"), []);
    db.questions.put(question());
    assert.equal(db.questions.answers("q-a").length, 1);
    assert.equal(db.businessSnapshot().filter(row => row.table.startsWith("question")).length, 2);
    db.resetLocalData();
    assert.equal(db.questions.get("q-a"), null);
    assert.equal(db.questions.getAnswer(answer().id), null);
    assert.equal(db.meta.get("deviceId"), "device-a");
  } finally { db.close(); }
});

test("malformed records and foreign answer identities never enter the database or outbox", () => {
  const db = DesktopDatabase.open(":memory:");
  try {
    assert.throws(() => db.questions.put({ ...question(), sites: ["claude", "claude"] }));
    assert.throws(() => db.questions.putAnswer({ ...answer(), id: "forged" }));
    assert.throws(() => db.questions.putAnswer({ ...answer(), capture: "complete", answerMarkdown: null }));
    assert.equal(db.outbox.count(), 0);
  } finally { db.close(); }
});

test("imported answers strip unsafe navigation targets and private query parameters", () => {
  const db = DesktopDatabase.open(':memory:');
  try {
    db.questions.put(question());
    db.questions.putAnswer({ ...answer(), conversationUrl: 'https://evil.example/chat/abcdefgh?token=secret' }, false);
    assert.equal(db.questions.answers('q-a')[0].conversationUrl, null);
    db.questions.putAnswer({ ...answer(2), conversationUrl: 'https://claude.ai/chat/abcdefgh?token=secret#fragment' }, false);
    assert.equal(db.questions.answers('q-a')[1].conversationUrl, 'https://claude.ai/chat/abcdefgh');
  } finally { db.close(); }
});
test("terminal deletion converges on the newest deletion version in either arrival order", () => {
  const db = DesktopDatabase.open(':memory:');
  try {
    db.questions.put(question()); db.questions.delete('q-a', 30, 'device-b');
    const deleted = db.questions.get('q-a')!;
    db.questions.put({ ...deleted, updatedAt: 20, deletedAt: 20 } as never, false);
    assert.equal(db.questions.get('q-a')!.updatedAt, 30);
  } finally { db.close(); }
});
test('details return only the selected attempt body while lists contain no answer bodies', () => {
  const db = DesktopDatabase.open(':memory:');
  try {
    db.questions.put(question()); db.questions.putAnswer(answer()); db.questions.putAnswer(answer(2));
    const initial = db.questions.detail('q-a')!;
    assert.equal(initial.loadedAnswerId, answer(2).id);
    assert.equal(initial.answers[0].answerMarkdown, null);
    assert.equal(initial.answers[1].answerMarkdown, '已保存回答');
    const chosen = db.questions.detail('q-a', answer().id)!;
    assert.equal(chosen.answers[0].answerMarkdown, '已保存回答');
    assert.equal(chosen.answers[1].answerMarkdown, null);
    assert.ok(db.questions.search().items[0].answers.every(a => !('answerMarkdown' in a)));
    assert.equal(db.questions.search().items[0].savedSites, 1);
  } finally { db.close(); }
});
