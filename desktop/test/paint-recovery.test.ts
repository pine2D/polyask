import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { transformSync } from "esbuild";
import { readSource } from "./fixtures";
import {
  PAINT_RECOVERY_SETTLE_MS,
  reassertPainting,
  startPaintRecovery
} from "../src/main/paint-recovery";

function fakeContents(id: number, throttling = false) {
  let destroyed = false;
  const calls: boolean[] = [];
  return Object.assign(new EventEmitter(), {
    id, calls, throttling,
    isDestroyed: () => destroyed,
    destroy() { destroyed = true; },
    getBackgroundThrottling() { return this.throttling; },
    setBackgroundThrottling(value: boolean) { calls.push(value); this.throttling = value; }
  });
}

test("reassertPainting re-sets false only when throttling is already disabled and the view is alive", () => {
  const painting = fakeContents(1, false);
  assert.equal(reassertPainting(painting), true);
  assert.deepEqual(painting.calls, [false], "re-asserting false is what wakes a widget born hidden");
  const experiment = fakeContents(2, true);
  assert.equal(reassertPainting(experiment), false);
  assert.deepEqual(experiment.calls, [], "the idle-throttling experiment's true must not be overridden");
  const gone = fakeContents(3, false);
  gone.destroy();
  assert.equal(reassertPainting(gone), false);
  assert.deepEqual(gone.calls, []);
  assert.equal(reassertPainting(null), false);
});

function recoveryHarness() {
  const window = Object.assign(new EventEmitter(), { destroyed: false, isDestroyed() { return this.destroyed; } });
  const power = new EventEmitter();
  const views = [fakeContents(11), fakeContents(12, true), fakeContents(13)];
  const timers = new Map<number, () => void>();
  let nextTimer = 1;
  const source = {
    getDiagnosticSites: () => views.map((view) => ({ webContentsId: view.id })),
    getLayout: () => ({})
  };
  const dispose = startPaintRecovery(window as never, source as never, {
    power,
    fromId: (id) => views.find((view) => view.id === id),
    setTimer: (callback, ms) => { assert.equal(ms, PAINT_RECOVERY_SETTLE_MS); const id = nextTimer++; timers.set(id, callback); return id; },
    clearTimer: (handle) => { timers.delete(handle as number); }
  });
  const flush = () => { const pending = [...timers.values()]; timers.clear(); for (const run of pending) run(); };
  return { window, power, views, timers, dispose, flush };
}

for (const [emitter, event] of [["window", "restore"], ["window", "show"], ["window", "focus"],
  ["power", "unlock-screen"], ["power", "resume"]] as const) {
  test(`${emitter} ${event} re-asserts painting on every live site view, then once more after settling`, () => {
    const h = recoveryHarness();
    (emitter === "window" ? h.window : h.power).emit(event);
    assert.deepEqual(h.views.map((view) => view.calls.length), [1, 0, 1]);
    assert.equal(h.timers.size, 1);
    h.flush();
    assert.deepEqual(h.views.map((view) => view.calls.length), [2, 0, 2]);
    h.dispose();
  });
}

test("bursts of window events keep a single trailing settle timer", () => {
  const h = recoveryHarness();
  h.window.emit("restore");
  h.window.emit("show");
  h.window.emit("focus");
  assert.equal(h.timers.size, 1);
  h.dispose();
});

test("disposal (explicit or on window close) removes every listener and the pending timer", () => {
  const h = recoveryHarness();
  h.window.emit("restore");
  h.dispose();
  assert.equal(h.timers.size, 0);
  for (const event of ["restore", "show", "focus", "closed"]) assert.equal(h.window.listenerCount(event), 0, event);
  for (const event of ["unlock-screen", "resume"]) assert.equal(h.power.listenerCount(event), 0, event);
  const closed = recoveryHarness();
  closed.window.emit("closed");
  assert.equal(closed.power.listenerCount("unlock-screen"), 0);
  closed.views[0].calls.length = 0;
  closed.power.emit("resume");
  assert.deepEqual(closed.views[0].calls, []);
});

test("a destroyed window or view is skipped instead of throwing", () => {
  const h = recoveryHarness();
  h.views[0].destroy();
  h.window.emit("focus");
  assert.deepEqual(h.views.map((view) => view.calls.length), [0, 0, 1]);
  h.window.destroyed = true;
  h.flush();
  assert.deepEqual(h.views.map((view) => view.calls.length), [0, 0, 1]);
  h.dispose();
});

function loadSiteView() {
  const require = createRequire(resolve(__dirname, "../src/main/site-view.ts"));
  const contents = Object.assign(fakeContents(7), {
    getURL: () => "https://claude.ai/new",
    setWindowOpenHandler() {}, loadURL: async () => {}, reload() {}
  });
  const module = { exports: {} as any };
  runInNewContext(transformSync(readSource("src/main/site-view.ts"), { loader: "ts", format: "cjs" }).code, {
    module, exports: module.exports, SITE_WINDOW_PRELOAD_WEBPACK_ENTRY: "preload.js",
    require: (name: string) => {
      if (name === "electron") return { WebContentsView: class { webContents = contents; } };
      return require(name);
    }
  });
  const sites = require("./sites").SITES;
  const noop = () => {};
  module.exports.createSiteView(sites.find((site: { key: string }) => site.key === "claude"),
    { onLoading: noop, onReady: noop, onFailure: noop, onCrash: noop, onExternal: noop });
  return contents;
}

test("every main-frame commit re-asserts painting so a view navigated while occluded starts drawing (I1)", () => {
  const contents = loadSiteView();
  contents.emit("did-navigate", {}, "https://claude.ai/new");
  assert.deepEqual(contents.calls, [false]);
  contents.throttling = true;
  contents.emit("did-navigate", {}, "https://claude.ai/new");
  assert.deepEqual(contents.calls, [false], "must not undo the idle-throttling experiment");
  contents.throttling = false;
  contents.emit("did-navigate-in-page", {}, "https://claude.ai/chat/1");
  assert.deepEqual(contents.calls, [false], "same-document navigations keep their widget; nothing to wake");
});
