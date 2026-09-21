import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter } from "node:events";
import { runInNewContext } from "node:vm";
import { transformSync } from "esbuild";
import { readSource } from "./fixtures";

function harness(enabled = true) {
  const rows: any[] = [];
  const stream = Object.assign(new EventEmitter(), { write: (line: string) => { rows.push(JSON.parse(line)); return true; }, end() {}, destroy() {} });
  let minimized = false;
  let created = 0;
  const contents = Object.assign(new EventEmitter(), { id: 1, isDestroyed: () => false, getZoomFactor: () => 1, isLoading: () => false });
  const window = Object.assign(new EventEmitter(), {
    webContents: contents, isDestroyed: () => false,
    isMinimized: () => minimized, isMaximized: () => !minimized,
    getBounds: () => ({ x: 0, y: 0, width: 2560, height: 1400 }),
    getContentSize: () => minimized ? [0, 0] : [2560, 1377]
  });
  const source = {
    getLayout: () => ({ mode: "overview", automaticFocus: false, page: 0, pageCount: 1, focused: "claude", placements: [] }),
    getDiagnosticSites: () => [{ site: "claude", webContentsId: 1, attached: true, bounds: { x: 4, y: 76, width: 840, height: 1260 }, url: "PRIVATE", content: "PRIVATE" }]
  };
  const timers = new Map<number, () => void>();
  let timerId = 0;
  const module = { exports: {} as any };
  runInNewContext(transformSync(readSource("src/main/window-trace.ts"), { loader: "ts", format: "cjs" }).code, {
    module, exports: module.exports, process: { env: enabled ? { POLYASK_WINDOW_TRACE: "/tmp/trace.jsonl" } : {}, platform: "win32", versions: { electron: "43.4.0", chrome: "test" } },
    setTimeout: (fn: () => void) => { timers.set(++timerId, fn); return timerId; }, clearTimeout: (id: number) => timers.delete(id),
    require: (name: string) => {
      if (name === "node:fs") return { mkdirSync() {}, createWriteStream: () => { created++; return stream; } };
      if (name === "node:path") return { dirname: () => "/tmp" };
      assert.equal(name, "electron");
      return { app: { getVersion: () => "1.3.0", getGPUFeatureStatus: () => ({ gpu_compositing: "enabled" }) },
        screen: { getAllDisplays: () => [{ scaleFactor: 1.5, bounds: { width: 2560, height: 1440 } }] },
        webContents: { fromId: () => contents } };
    }
  });
  const dispose = module.exports.startWindowTrace(window, source);
  return { rows, stream, window, contents, timers, dispose, created: () => created, minimize: () => { minimized = true; window.emit("resize"); window.emit("minimize"); } };
}

test("window tracing is opt-in and does not attach listeners or create files normally", () => {
  const h = harness(false);
  assert.equal(h.created(), 0);
  assert.equal(h.window.eventNames().length, 0);
  assert.equal(h.timers.size, 0);
  h.dispose();
});

test("trace records minimized geometry, layout and load events without page data", () => {
  const h = harness();
  h.minimize();
  h.contents.emit("did-start-loading");
  h.dispose();
  assert.ok(h.rows.some((row) => row.event === "minimize" && row.window.minimized && row.window.contentSize[0] === 0));
  assert.ok(h.rows.some((row) => row.event === "site:claude:did-start-loading"));
  assert.ok(!JSON.stringify(h.rows).includes("PRIVATE"));
  assert.equal(h.window.eventNames().length, 0);
  assert.equal(h.contents.eventNames().length, 0);
  assert.equal(h.timers.size, 0);
});

test("trace write errors stop sampling without crashing the app", () => {
  const h = harness();
  assert.doesNotThrow(() => h.stream.emit("error", new Error("disk full")));
  const count = h.rows.length;
  h.window.emit("resize");
  assert.equal(h.rows.length, count);
  assert.equal(h.timers.size, 0);
});

test("trace caps event volume and removes listeners when the limit is reached", () => {
  const h = harness();
  for (let i = 0; i < 5000; i++) h.window.emit("resize");
  assert.ok(h.rows.length <= 4096);
  assert.equal(h.window.eventNames().length, 0);
  assert.equal(h.timers.size, 0);
});
