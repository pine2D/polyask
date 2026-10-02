import assert from "node:assert/strict";
import test from "node:test";
import { acceptBroadcastResult } from "../src/main/broadcast-result";
import type { QuestionCaptureService } from "../src/main/question-capture-service";
import type { QuestionHistoryService } from "../src/main/question-history-service";
import type { ViewManager } from "../src/main/view-manager";

test("a late broadcast result cannot restore status or capture after local reset", () => {
  const events: string[] = [];
  const repository = { lifecycle: 1 };
  const questions = { repository, result: () => { events.push("answer"); } } as unknown as QuestionHistoryService;
  const capture = { start: () => { events.push("capture"); } } as unknown as QuestionCaptureService;
  const manager = { markStatus: () => { events.push("status"); },
    watchGeneration: () => { events.push("watch"); } } as unknown as ViewManager;
  acceptBroadcastResult(1, "run", { site: "claude", ok: true }, questions, capture, manager);
  assert.deepEqual(events, ["answer", "capture", "status", "watch"]);
  repository.lifecycle = 2;
  acceptBroadcastResult(1, "run", { site: "claude", ok: true }, questions, capture, manager);
  assert.deepEqual(events, ["answer", "capture", "status", "watch"]);
});
