import assert from "node:assert/strict";
import test from "node:test";
import { acceptBroadcastResult } from "../src/main/broadcast-result";
import type { QuestionCaptureService } from "../src/main/question-capture-service";
import type { QuestionHistoryService } from "../src/main/question-history-service";
import type { ViewManager } from "../src/main/view-manager";

test("a late broadcast result cannot restore status or capture after local reset", () => {
  const events: string[] = [];
  const repository = { lifecycle: 1 };
  const questions = { repository, ownsResult: () => true, result: () => { events.push("answer"); return true; } } as unknown as QuestionHistoryService;
  const capture = { start: () => { events.push("capture"); } } as unknown as QuestionCaptureService;
  const manager = { markStatus: () => { events.push("status"); },
    watchGeneration: () => { events.push("watch"); } } as unknown as ViewManager;
  acceptBroadcastResult(1, "run", { site: "claude", ok: true }, questions, capture, manager, "token");
  assert.deepEqual(events, ["answer", "capture", "status", "watch"]);
  repository.lifecycle = 2;
  acceptBroadcastResult(1, "run", { site: "claude", ok: true }, questions, capture, manager, "token");
  assert.deepEqual(events, ["answer", "capture", "status", "watch"]);
});
test('a missing history entry does not suppress successful send feedback', () => {
  const events: string[] = [];
  const questions = { repository: { lifecycle: 1 }, ownsResult: () => false, result: () => false } as unknown as QuestionHistoryService;
  const capture = { start: () => { events.push('capture'); } } as unknown as QuestionCaptureService;
  const manager = { markStatus: () => { events.push('status'); }, watchGeneration: () => { events.push('watch'); } } as unknown as ViewManager;
  acceptBroadcastResult(1, 'run', { site: 'claude', ok: true }, questions, capture, manager, undefined);
  assert.deepEqual(events, ['capture', 'status', 'watch']);
});
test('a rejected old attempt cannot update status or start generation monitoring', () => {
  const events: string[] = [];
  const questions = { repository: { lifecycle: 1 }, ownsResult: () => false, result: () => false } as unknown as QuestionHistoryService;
  const capture = { start: () => { events.push('capture'); } } as unknown as QuestionCaptureService;
  const manager = { markStatus: () => { events.push('status'); }, watchGeneration: () => { events.push('watch'); } } as unknown as ViewManager;
  acceptBroadcastResult(1, 'run', { site: 'claude', ok: true }, questions, capture, manager, 'old-token');
  assert.deepEqual(events, []);
});

test('a failure saving an owned result does not suppress successful send feedback', () => {
  let status = 0;
  const questions = { repository: { lifecycle: 1 }, ownsResult: () => true, result: () => false } as unknown as QuestionHistoryService;
  const capture = { start: () => {} } as unknown as QuestionCaptureService;
  const manager = { markStatus: () => { status++; }, watchGeneration: () => {} } as unknown as ViewManager;
  acceptBroadcastResult(1, 'run', { site: 'claude', ok: true }, questions, capture, manager, 'owned-token');
  assert.equal(status, 1);
});
