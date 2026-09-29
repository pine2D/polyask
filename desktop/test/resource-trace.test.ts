import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter } from "node:events";
import { runInNewContext } from "node:vm";
import { transformSync } from "esbuild";
import { readSource } from "./fixtures";

function harness(enabled = true) {
  const rows: any[] = [];
  let created = 0, reads = 0, ended = 0, acceptWrites = true, creationTime = 123;
  const stream = Object.assign(new EventEmitter(), {
    write(line: string) { rows.push(JSON.parse(line)); return acceptWrites; }, end() { ended++; }
  });
  const contents = (pid: number) => ({ isDestroyed: () => false, getOSProcessId: () => pid,
    isLoading: () => false, getBackgroundThrottling: () => false });
  const views = new Map([[2, contents(20)], [3, contents(20)]]);
  const window = Object.assign(new EventEmitter(), { isDestroyed: () => false,
    isMinimized: () => false, isVisible: () => true, isFocused: () => true,
    webContents: contents(10) });
  const source = { getLayout: () => ({ page: 0, placements: [{ key: "claude" }] }),
    getDiagnosticSites: () => [...views.keys()].map(id => ({ site: id === 2 ? "claude" : "kimi",
      webContentsId: id, attached: true, url: "PRIVATE", text: "PRIVATE" })) };
  const timers = new Map<number, () => void>();
  let timerId = 0;
  const module = { exports: {} as any };
  runInNewContext(transformSync(readSource("src/main/resource-trace.ts"), { loader: "ts", format: "cjs" }).code, {
    module, exports: module.exports,
    process: { env: enabled ? { POLYASK_RESOURCE_TRACE: "/tmp/resources.jsonl" } : {},
      platform: "linux", arch: "x64", versions: { electron: "43.4.0", chrome: "test" } },
    setInterval: (fn: () => void) => { timers.set(++timerId, fn); return timerId; },
    clearInterval: (id: number) => timers.delete(id),
    require(name: string) {
      if (name === "node:fs") return { mkdirSync() {}, createWriteStream(_path: string, options: any) {
        assert.equal(options.flags, "wx"); created++; return stream;
      } };
      if (name === "node:path") return { dirname: () => "/tmp" };
      assert.equal(name, "electron");
      return { app: { getVersion: () => "1.9.0", getGPUFeatureStatus: () => ({ gpu_compositing: "enabled" }),
        getAppMetrics() { reads++; return [10, 20, 30].map(pid => ({ pid, type: pid === 30 ? "GPU" : "Tab",
          creationTime, cpu: { percentCPUUsage: 2 }, memory: { workingSetSize: 100, peakWorkingSetSize: 120 },
          name: "PRIVATE", serviceName: "PRIVATE" })); } }, webContents: { fromId: (id: number) => views.get(id) } };
    }
  });
  const dispose = module.exports.startResourceTrace(window, source);
  return { rows, stream, window, views, timers, dispose, tick: () => [...timers.values()].forEach(fn => fn()),
    backpressure: () => { acceptWrites = false; }, restart: () => { creationTime++; },
    created: () => created, reads: () => reads, ended: () => ended };
}

test("resource tracing has no normal-run files, listeners, timers or metric reads", () => {
  const h = harness(false);
  assert.equal(h.created(), 0); assert.equal(h.reads(), 0);
  assert.equal(h.timers.size, 0); assert.equal(h.window.eventNames().length, 0);
  h.dispose();
});

test("resource samples associate shared renderer PIDs without counting memory twice or exporting content", () => {
  const h = harness();
  h.tick();
  const samples = h.rows.filter(row => row.kind === "resource-sample");
  assert.equal(samples[0].cpuIntervalValid, false);
  assert.equal(samples[1].cpuIntervalValid, true);
  assert.equal(samples[1].processes.length, 3);
  assert.deepEqual(samples[1].processes.find((p: any) => p.pid === 20).sites, ["claude", "kimi"]);
  assert.equal(samples[1].processes.find((p: any) => p.pid === 10).shell, true);
  assert.deepEqual(samples[1].processes.find((p: any) => p.pid === 30).sites, []);
  assert.equal(samples[1].sites[0].inCurrentPage, true);
  assert.equal(samples[1].sites[1].inCurrentPage, false);
  assert.equal(samples[1].processes.reduce((n: number, p: any) => n + p.workingSetKb, 0), 300);
  assert.ok(!JSON.stringify(h.rows).includes("PRIVATE"));
  h.views.delete(2); h.tick();
  assert.deepEqual(h.rows.at(-1).processes.find((p: any) => p.pid === 20).sites, ["kimi"]);
  h.dispose();
});

test("resource trace stops cleanly on I/O failure, backpressure or window close", () => {
  for (const stop of [
    (h: ReturnType<typeof harness>) => h.stream.emit("error", new Error("disk full")),
    (h: ReturnType<typeof harness>) => { h.backpressure(); h.tick(); },
    (h: ReturnType<typeof harness>) => h.window.emit("closed")
  ]) {
    const h = harness(); stop(h);
    const count = h.rows.length;
    h.tick(); h.dispose();
    assert.equal(h.rows.length, count); assert.equal(h.ended(), 1);
    assert.equal(h.timers.size, 0); assert.equal(h.window.eventNames().length, 0);
  }
});

test("resource trace remains bounded during a long session", () => {
  const h = harness();
  for (let i = 0; i < 1000; i++) h.tick();
  assert.ok(h.rows.length <= 362);
  assert.equal(h.timers.size, 0); assert.equal(h.ended(), 1);
});

test("a reused PID is marked as a new CPU measurement interval", () => {
  const h = harness(); h.tick();
  assert.equal(h.rows.at(-1).processes[0].cpuIntervalValid, true);
  h.restart(); h.tick();
  assert.equal(h.rows.at(-1).processes[0].cpuIntervalValid, false);
  h.tick();
  assert.equal(h.rows.at(-1).processes[0].cpuIntervalValid, true);
  h.dispose();
});
