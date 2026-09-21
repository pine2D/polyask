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
