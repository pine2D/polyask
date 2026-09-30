import assert from "node:assert/strict";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { transformSync } from "esbuild";
import { readSource } from "./fixtures";
import { EventEmitter } from "node:events";
import { RuntimeProcessDiagnostics } from "../src/main/runtime-process-diagnostics";

function harness(report = false) {
  let retainedEvents = 0, samples = 0;
  const writes: string[] = [];
  const events = new Map<string, (...args: any[]) => void>();
  const timers: (() => void)[] = [];
  const app = Object.assign(new EventEmitter(), { getAppMetrics: () => [], quit() {} });
  const processDiagnostics = new RuntimeProcessDiagnostics();
  const module = { exports: {} as { startRuntimeGates: (window: unknown) => any } };
  const code = transformSync(readSource("src/main/runtime-gates.ts"), { loader: "ts", format: "cjs" }).code;
  runInNewContext(code, { module, exports: module.exports, process: { env: report ? { POLYASK_SOAK_REPORT: "/tmp/test-report" } : {} },
    setInterval: (fn: () => void) => { timers.push(fn); return 1; }, setTimeout: (fn: () => void) => { timers.push(fn); return 2; }, clearInterval() {}, clearTimeout() {},
    require: (name: string) => {
      if (name === "electron") return { app };
      if (name === "node:fs") return { mkdirSync() {}, writeFileSync() {}, appendFileSync: (_path: string, value: string) => writes.push(value) };
      if (name === "node:path") return { dirname: () => "/tmp" };
      if (name === "./diagnostics") return { buildDiagnosticSnapshot: () => ({ ok: true }) };
      if (name === "./window-trace") return { startWindowTrace: () => () => {} };
      if (name === "./idle-throttling") return { startIdleThrottlingExperiment: () => () => {} };
      if (name === "./resource-trace") return { startResourceTrace: () => () => {} };
      if (name === "./runtime-process-diagnostics") return { runtimeProcessDiagnostics: processDiagnostics };
      assert.equal(name, "./stability-monitor");
      return { StabilityMonitor: class {
        record(event: unknown) { retainedEvents++; return event; }
        sample() { samples++; return { kind: "sample" }; }
        summary() { return { kind: "summary", failures: [] }; }
      } };
    }
  });
  const gates = module.exports.startRuntimeGates({ on: (key: string, fn: any) => events.set(key, fn), webContents: { on: (key: string, fn: any) => events.set(key, fn) } });
  return { gates, events, timers, writes, app, processDiagnostics, retained: () => retainedEvents, samples: () => samples };
}

test("normal runs do not retain diagnostic events or schedule resource sampling", () => {
  const h = harness();
  for (let i = 0; i < 100_000; i++) h.gates.record({ type: "did-fail-load", site: "claude", code: "-105" });
  h.events.get("unresponsive")!();
  h.events.get("render-process-gone")!({}, { reason: "crashed" });
  h.app.emit("child-process-gone", {}, { type: "GPU", reason: "launch-failed", systemErrorCode: 5, name: "private" });
  assert.equal(h.retained(), 0);
  assert.equal(h.samples(), 0);
  assert.equal(h.timers.length, 0);
  assert.equal(h.writes.length, 0);
  assert.deepEqual(h.processDiagnostics.snapshot(), [{ processType: "GPU", reason: "launch-failed", systemErrorCode: 5 }]);
  h.gates.dispose();
  assert.equal(h.app.listenerCount("child-process-gone"), 0);
});

test("explicit soak runs still retain events, sample metrics and write a summary", () => {
  const h = harness(true);
  h.gates.record({ type: "did-fail-load", code: "-105" });
  h.events.get("unresponsive")!();
  h.events.get("render-process-gone")!({}, { reason: "crashed" });
  h.app.emit("child-process-gone", {}, { type: "Utility", reason: "oom", name: "private" });
  h.timers[0](); h.timers[1]();
  assert.equal(h.retained(), 4);
  assert.match(h.writes.join(""), /child-process-gone/);
  assert.doesNotMatch(h.writes.join(""), /private/);
  assert.equal(h.samples(), 3);
  assert.equal(JSON.parse(h.writes.at(-1)!).kind, "summary");
  h.gates.dispose();
});
