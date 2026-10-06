import assert from "node:assert/strict";
import test from "node:test";
import { DesktopDatabase } from "../src/main/database";
import { QuestionRestoreService } from "../src/main/question-restore-service";
import { safeQuestionUrl } from "../src/main/question-navigation";
import { questionAnswerId } from "../src/main/question-repository";
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
    navigate: async (_site, target) => { visited.push(target); url = target; }, abandon: () => {}, beforeNavigate: async () => {}
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
    selection: () => ['claude'], select: () => {}, context: () => context, abandon: () => {},
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
    navigate: async () => {}, abandon: () => {}, beforeNavigate: async () => {}
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

// 豆包新会话的 /chat/local_<数字> 是发送确认前的临时地址（2026-10-04 Windows 真机），打不开原会话：既不当作会话地址返回，也不落库。
test("Doubao provisional local_ routes are never recorded as conversation URLs", () => {
  assert.equal(safeQuestionUrl("doubao", "https://www.doubao.com/chat/38445437171009282?from=x"), "https://www.doubao.com/chat/38445437171009282");
  for (const url of ["https://www.doubao.com/chat/local_6289182192238156", "https://www.doubao.com/chat/local_6289182192238156/"]) assert.equal(safeQuestionUrl("doubao", url), null);
  const db = DesktopDatabase.open(":memory:");
  try {
    db.questions.put({ ...questionFixture(), sites: ["doubao"] });
    const answer = { ...questionAnswerFixture(), site: "doubao" as const };
    const id = questionAnswerId(answer.questionId, "doubao", answer.attempt);
    db.questions.putAnswer({ ...answer, id, conversationUrl: "https://www.doubao.com/chat/local_6289182192238156" });
    const stored = db.questions.getAnswer(id);
    assert.ok(stored && !("deletedAt" in stored));
    assert.equal(stored.conversationUrl, null);
  } finally { db.close(); }
});

// 2026-10-05 Windows：恢复超时只 stop()，Chromium 只发 did-stop-loading，站点停在 loading，视图里却还是旧会话、群发照常打进去。
// 超时与用户取消都要和新会话超时一样 abandon（钉 load_failed），由视图身份限定到发起导航时的那个页面。
test("a restore that never commits is abandoned (pinned load_failed) at the per-site cap, and so is a cancel in flight", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const db = DesktopDatabase.open(":memory:");
  db.questions.put(questionFixture());
  db.questions.putAnswer({ ...questionAnswerFixture(), conversationUrl: "https://claude.ai/chat/12345678" });
  const abandoned: string[] = [];
  let navigations = 0;
  const restore = new QuestionRestoreService(db.questions, {
    selection: () => ["claude"], select: () => {}, context: () => ({ id: 7, url: "https://claude.ai/chat/87654321" }),
    navigate: () => { navigations++; return new Promise<void>(() => {}); },
    abandon: (site, contentsId) => { abandoned.push(`${site}:${contentsId}`); }, beforeNavigate: async () => {}
  });
  const until = async (condition: () => boolean) => { for (let i = 0; i < 50 && !condition(); i++) await new Promise<void>((r) => setImmediate(r)); };
  try {
    const timedOut = restore.restore(restore.preview("q-a").token, true);
    await until(() => navigations === 1);
    t.mock.timers.tick(19_999);
    assert.deepEqual(abandoned, []);
    t.mock.timers.tick(1);
    assert.equal((await timedOut)[0].state, "timeout");
    assert.deepEqual(abandoned, ["claude:7"]);

    const cancelled = restore.restore(restore.preview("q-a").token, true);
    await until(() => navigations === 2);
    restore.cancel();
    assert.deepEqual(abandoned, ["claude:7", "claude:7"], "cancel abandons the site still waiting to commit");
    t.mock.timers.tick(20_000);
    assert.equal((await cancelled)[0].state, "cancelled");
    assert.equal(abandoned.length, 2, "the cap does not abandon a second time after cancel");
  } finally { db.close(); }
});
