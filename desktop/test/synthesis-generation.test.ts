import assert from "node:assert/strict";
import test from "node:test";
import { sendTrackedSynthesis } from "../src/main/synthesis-generation";
import { BroadcastCoordinator } from "../src/main/broadcast";
import type { ViewManager } from "../src/main/view-manager";

test("assisted sends start completion monitoring without adding broadcast submission metadata", async () => {
  const events: any[] = [];
  const manager = {
    beginGenerationRun: (...args: any[]) => events.push(["begin", ...args]),
    markStatus: (status: any) => events.push(["status", status]),
    sendCommand: async () => ({ ok: true }),
    confirmSubmitted: async () => null,
    watchGeneration: (...args: any[]) => events.push(["watch", ...args])
  } as unknown as ViewManager;
  const results = await sendTrackedSynthesis({ sites: ["kimi"], text: "Synthetic", tier: null, images: [] }, manager, new BroadcastCoordinator(), 44_000);
  assert.equal(results[0].ok, true);
  assert.equal(events[0][0], "begin");
  assert.equal(events[0][3], false, "must not clear broadcast submission counters");
  assert.equal(events.at(-1)[0], "watch");
  assert.equal(events.at(-1)[1], events[0][1]);
  for (const event of events.filter(e => e[0] === "status")) assert.equal(event[1].submission, undefined);
});
