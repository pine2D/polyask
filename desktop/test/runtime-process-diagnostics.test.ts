import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { RuntimeProcessDiagnostics } from "../src/main/runtime-process-diagnostics";
import { normalizeProcessFailure, PROCESS_TYPES } from "../src/shared/runtime-process";

test("process failures discard arbitrary names, paths and invalid enum values", () => {
  assert.deepEqual(normalizeProcessFailure({ type: "GPU", reason: "launch-failed", exitCode: 5,
    systemErrorCode: 5, name: "private account", serviceName: "https://private.invalid", path: "/private" }),
  { processType: "GPU", reason: "launch-failed", exitCode: 5, systemErrorCode: 5 });
  for (const value of [null, {}, { type: "private", reason: "crashed" },
    { type: "Utility", reason: "private" }, { type: "GPU", reason: "clean-exit" }]) {
    assert.equal(normalizeProcessFailure(value), null);
  }
  assert.deepEqual(normalizeProcessFailure({ type: "Utility", reason: "oom", exitCode: NaN,
    systemErrorCode: "https://private.invalid" }), { processType: "Utility", reason: "oom" });
  assert.deepEqual(normalizeProcessFailure({ type: "GPU", reason: "crashed", exitCode: -1, systemErrorCode: 5 }),
    { processType: "GPU", reason: "crashed", exitCode: -1 });
  for (const invalid of [Infinity, 0.5, -2_147_483_649, 4_294_967_296]) {
    assert.deepEqual(normalizeProcessFailure({ type: "GPU", reason: "launch-failed", exitCode: invalid,
      systemErrorCode: invalid }), { processType: "GPU", reason: "launch-failed" });
  }
  assert.deepEqual(normalizeProcessFailure({ type: "GPU", reason: "launch-failed", exitCode: -2_147_483_648,
    systemErrorCode: 4_294_967_295 }), { processType: "GPU", reason: "launch-failed", exitCode: -2_147_483_648,
    systemErrorCode: 4_294_967_295 });
});

test("latest failures are bounded by process type and detached snapshots cannot mutate them", () => {
  const monitor = new RuntimeProcessDiagnostics();
  const events: unknown[] = [];
  const app = new EventEmitter();
  const stop = monitor.listen(app, event => events.push(event));
  app.emit("child-process-gone", {}, { type: "GPU", reason: "clean-exit", exitCode: 0 });
  assert.equal(events.length, 0);
  for (let i = 0; i < 1000; i++) app.emit("child-process-gone", {}, { type: "GPU", reason: "crashed", exitCode: i });
  app.emit("child-process-gone", {}, { type: "Utility", reason: "launch-failed", systemErrorCode: 5 });
  assert.deepEqual(monitor.snapshot(), [{ processType: "GPU", reason: "crashed", exitCode: 999 },
    { processType: "Utility", reason: "launch-failed", systemErrorCode: 5 }]);
  (monitor.snapshot()[0] as any).reason = "private";
  assert.equal(monitor.snapshot()[0].reason, "crashed");
  for (const type of PROCESS_TYPES) app.emit("child-process-gone", {}, { type, reason: "crashed" });
  assert.equal(monitor.snapshot().length, PROCESS_TYPES.length);
  stop(); stop();
  assert.equal(app.listenerCount("child-process-gone"), 0);
  assert.deepEqual(monitor.snapshot(), []);
});
