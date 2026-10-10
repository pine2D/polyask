import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { transformSync } from "esbuild";
import { readSource } from "./fixtures";
import { DesktopDatabase } from "../src/main/database";
import { QuestionHistoryService } from "../src/main/question-history-service";
import { upgradeSubmission } from "../src/main/submission-upgrade";
import { statusForResult } from "../src/main/status";
import type { SiteStatus } from "../src/shared/protocol";

// 2026-10-10 审查 R10：取消辅助综合曾走群发的 polyask:cancel，连带 holdSubmission 上一轮「提交未确认」站，
// 迟到确认再也升不上「已发送」，用户只能确认重试——同一问题可能被问两遍。
function register() {
  const require = createRequire(resolve(__dirname, "../src/main/synthesis-ipc.ts"));
  const handlers = new Map<string, (event: unknown, value?: unknown) => unknown>();
  const listeners = new Map<string, (event: unknown) => void>();
  const events: string[] = [];
  const module = { exports: {} as any };
  runInNewContext(transformSync(readSource("src/main/synthesis-ipc.ts"), { loader: "ts", format: "cjs" }).code, {
    module, exports: module.exports,
    require: (name: string) => name === "electron" ? { ipcMain: {
      handle: (channel: string, handler: (event: unknown, value?: unknown) => unknown) => handlers.set(channel, handler),
      on: (channel: string, listener: (event: unknown) => void) => listeners.set(channel, listener),
      removeHandler: (channel: string) => handlers.delete(channel),
      removeAllListeners: (channel: string) => listeners.delete(channel)
    } } : require(name)
  });
  const dispose = module.exports.registerSynthesisIpc({
    synthesis: { send: async () => events.push("send"), collect: async () => events.push("collect"),
      save: async () => events.push("save"), cancel: () => events.push("synthesis.cancel") },
    synthesisCoordinator: { cancel: () => events.push("synthesisCoordinator.cancel") },
    gate: { run: (action: () => unknown) => action() },
    resetting: () => false,
    trusted: (event: { trusted?: boolean }) => event.trusted === true
  });
  return { handlers, listeners, events, dispose: dispose as () => void };
}

test("synthesis cancel reaches only the synthesis dispatch and its navigation", () => {
  const h = register();
  const cancel = h.listeners.get("polyask:synthesis-cancel")!;
  cancel({ trusted: false });
  assert.deepEqual(h.events, []);
  cancel({ trusted: true });
  assert.deepEqual([...h.events].sort(), ["synthesis.cancel", "synthesisCoordinator.cancel"]);
  h.dispose();
  assert.equal(h.handlers.size, 0);
  assert.equal(h.listeners.size, 0);
});

test("synthesis IPC keeps its trusted entry points and save validation", async () => {
  const h = register();
  for (const channel of ["polyask:synthesis-send", "polyask:synthesis-collect", "polyask:synthesis-save"]) {
    assert.throws(() => h.handlers.get(channel)!({ trusted: false }, true), /untrusted_sender|invalid_synthesis_save/);
  }
  await h.handlers.get("polyask:synthesis-send")!({ trusted: true }, {});
  await h.handlers.get("polyask:synthesis-collect")!({ trusted: true });
  await h.handlers.get("polyask:synthesis-save")!({ trusted: true }, false);
  assert.throws(() => h.handlers.get("polyask:synthesis-save")!({ trusted: true }, "yes"), /invalid_synthesis_save/);
  assert.deepEqual(h.events, ["send", "collect", "save"]);
  h.dispose();
});

test("a previous broadcast's late confirmation still upgrades after a synthesis cancel", () => {
  const db = DesktopDatabase.open(":memory:");
  const history = new QuestionHistoryService(db.questions, { deviceId: () => "local" });
  const h = register();
  try {
    const question = history.begin({ runId: "earlier", sites: ["claude"], text: "Question", tier: null, images: [] })!;
    history.result("earlier", { site: "claude", ok: false, code: "submit_unconfirmed" });
    h.listeners.get("polyask:synthesis-cancel")!({ trusted: true });
    let status: SiteStatus = statusForResult("claude", { ok: false, code: "submit_unconfirmed" }, "earlier");
    const watched: string[] = [];
    history.setSubmissionHandler((runId, site) => {
      upgradeSubmission({ getStatuses: () => [status], markStatus: next => { status = next; },
        watchGeneration: run => { watched.push(run); } }, runId, site);
    });
    history.accept("claude", { token: history.token("claude")!, owned: true, locate: "selector", generation: "generating" }, history.readMark());
    assert.equal(db.questions.answers(question.id)[0].submission, "submitted");
    assert.equal(status.submission?.state, "sent");
    assert.deepEqual(watched, ["earlier"]);
  } finally { h.dispose(); db.close(); }
});
