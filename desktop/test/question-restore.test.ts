import assert from "node:assert/strict";
import test from "node:test";
import { DesktopDatabase } from "../src/main/database";
import { QuestionRestoreService } from "../src/main/question-restore-service";
import { safeQuestionUrl } from "../src/main/question-navigation";
import { questionFixture, questionAnswerFixture } from "./question-fixtures";

test("history navigation permits recorded site conversations but rejects credentials and unrelated routes", () => {
  assert.equal(safeQuestionUrl("claude", "https://claude.ai/chat/12345678?token=secret#part"), "https://claude.ai/chat/12345678");
  for (const url of ["javascript:alert(1)", "https://evil.test/chat/12345678", "https://x:secret@claude.ai/chat/12345678", "https://claude.ai/new", "https://claude.ai/oauth/12345678"]) assert.equal(safeQuestionUrl("claude", url), null);
});
test("restore requires current confirmation and never dispatches a question", async () => {
  const db = DesktopDatabase.open(":memory:");
  db.questions.put(questionFixture());
  db.questions.putAnswer({ ...questionAnswerFixture(), conversationUrl: "https://claude.ai/chat/12345678" });
  let url = "https://claude.ai/chat/87654321";
  const visited: string[] = [];
  const restore = new QuestionRestoreService(db.questions, {
    selection: () => ["claude"], select: () => {}, context: () => ({ id: 1, url }),
    navigate: async (_site, target) => { visited.push(target); url = target; }, stop: () => {}, beforeNavigate: async () => {}
  });
  try {
    const preview = restore.preview("q-a");
    assert.equal(preview.needsConfirmation, true);
    await assert.rejects(restore.restore(preview.token, false), /history_confirmation_required/);
    assert.deepEqual(visited, []);
    const next = restore.preview("q-a");
    assert.equal((await restore.restore(next.token, true))[0].state, "opened");
    assert.deepEqual(visited, ["https://claude.ai/chat/12345678"]);
    const same = restore.preview("q-a");
    await restore.restore(same.token, false);
    assert.equal(visited.length, 1);
    const stale = restore.preview("q-a"); url = "https://claude.ai/chat/changed1";
    await assert.rejects(restore.restore(stale.token, true), /history_restore_stale/);
  } finally { db.close(); }
});
test('restore rechecks the confirmed view after the snapshot flush yields', async () => {
  const db = DesktopDatabase.open(':memory:');
  db.questions.put(questionFixture()); db.questions.putAnswer({ ...questionAnswerFixture(), conversationUrl: 'https://claude.ai/chat/12345678' });
  let context = { id: 1, url: 'https://claude.ai/chat/87654321' }, release!: () => void;
  const visited: string[] = [];
  const restore = new QuestionRestoreService(db.questions, {
    selection: () => ['claude'], select: () => {}, context: () => context, stop: () => {},
    navigate: async (_site, url) => { visited.push(url); }, beforeNavigate: () => new Promise<void>(r => { release = r; })
  });
  try {
    const pending = restore.restore(restore.preview('q-a').token, true);
    context = { id: 2, url: 'https://claude.ai/chat/newdraft' }; release();
    await assert.rejects(pending, /history_restore_stale/); assert.deepEqual(visited, []);
  } finally { db.close(); }
});
test('restoring one attempt uses the workspace canonical site order', async () => {
  const db = DesktopDatabase.open(':memory:');
  db.questions.put(questionFixture()); db.questions.putAnswer({ ...questionAnswerFixture(), conversationUrl: 'https://claude.ai/chat/12345678' });
  let selected: import('../src/shared/contracts').SiteKey[] = ['kimi'];
  const restore = new QuestionRestoreService(db.questions, {
    selection: () => selected, select: () => { selected = ['claude', 'kimi']; }, context: () => ({ id: 1, url: 'https://claude.ai/' }),
    navigate: async () => {}, stop: () => {}, beforeNavigate: async () => {}
  });
  try { assert.equal((await restore.restore(restore.preview('q-a', questionAnswerFixture().id).token, true))[0].state, 'opened'); }
  finally { db.close(); }
});

test("verified Yuanbao and ChatGLM conversation routes retain only their identity", () => {
  assert.equal(safeQuestionUrl("yuanbao", "https://yuanbao.tencent.com/chat/abcdefghij/klmnopqrstu?tracking=1"), "https://yuanbao.tencent.com/chat/abcdefghij/klmnopqrstu");
  assert.equal(safeQuestionUrl("chatglm", "https://chatglm.cn/main/alltoolsdetail?lang=zh&cid=0123456789abcdef01234567&tracking=1"), "https://chatglm.cn/main/alltoolsdetail?cid=0123456789abcdef01234567");
  assert.equal(safeQuestionUrl("chatglm", "https://chatglm.cn/main/alltoolsdetail?cid=bad"), null);
  assert.equal(safeQuestionUrl("chatglm", "https://chatglm.cn/main/alltoolsdetail?cid=0123456789abcdef01234567&cid=abcdef0123456789abcdef01"), null);
});
