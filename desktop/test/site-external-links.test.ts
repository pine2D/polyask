import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { transformSync } from "esbuild";

import { ExternalOpenGate, handsOffToBrowser } from "../src/main/site-external-links";
import { readSource } from "./fixtures";

// 真实 createSiteView 跑在桩 WebContentsView 上（同 paint-recovery.test.ts），只换掉 Electron 本身。
function loadSiteView({ loadURL = async (_url: string) => {} } = {}) {
  const require = createRequire(resolve(__dirname, "../src/main/site-view.ts"));
  let openHandler: (details: { url: string }) => { action: string } = () => ({ action: "allow" });
  const loads: string[] = [];
  const contents = Object.assign(new EventEmitter(), {
    id: 7, isDestroyed: () => false, getURL: () => "https://claude.ai/new",
    getBackgroundThrottling: () => false, setBackgroundThrottling() {}, reload() {},
    setWindowOpenHandler: (handler: typeof openHandler) => { openHandler = handler; },
    loadURL: (url: string) => { loads.push(url); return loadURL(url); }
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
  const external: string[] = [];
  const phases: string[] = [];
  const noop = () => {};
  module.exports.createSiteView(sites.find((site: { key: string }) => site.key === "claude"),
    { onLoading: () => phases.push("loading"), onReady: () => phases.push("ready"), onFailure: noop, onCrash: noop, onExternal: (url: string) => external.push(url) });
  const click = (type = "mouseDown") => contents.emit("input-event", {}, { type });
  const navigate = (url: string) => {
    // Electron 先发 did-start-navigation，will-navigate 由 NavigationThrottle 随后发出。
    contents.emit("did-start-navigation", { url, isMainFrame: true, isSameDocument: false });
    let prevented = false;
    contents.emit("will-navigate", { url, isMainFrame: true, preventDefault: () => { prevented = true; } });
    return prevented;
  };
  return { contents, external, loads, phases, click, navigate, open: (url: string) => openHandler({ url }) };
}

// R15：http:// 是 block（受管视图绝不明文加载），此前连转交都没有——用户点了毫无反应。
test("a clicked plain-http link is refused by the view and handed to the browser", () => {
  const view = loadSiteView();
  view.click();
  assert.equal(view.navigate("http://example.com/cited"), true, "the guarded view never loads plain http");
  assert.deepEqual(view.external, ["http://example.com/cited"]);
  view.click();
  assert.equal(view.open("http://example.com/popup").action, "deny");
  assert.deepEqual(view.external, ["http://example.com/cited", "http://example.com/popup"]);

  view.click();
  assert.equal(view.navigate("javascript:alert(1)"), true);
  assert.equal(view.navigate("file:///etc/passwd"), true);
  assert.deepEqual(view.external.length, 2, "other blocked schemes still die in place");
});

test("only http(s) refusals qualify for the browser hop", () => {
  assert.equal(handsOffToBrowser("external", "https://example.com/"), true);
  assert.equal(handsOffToBrowser("block", "http://example.com/"), true);
  assert.equal(handsOffToBrowser("block", "data:text/html,x"), false);
  assert.equal(handsOffToBrowser("block", "not a url"), false);
  assert.equal(handsOffToBrowser("transit", "https://www.google.com/sorry"), false);
  assert.equal(handsOffToBrowser("auth", "https://accounts.google.com/"), false);
});

// R16：window.open 不带发起帧，任何嵌入的第三方 iframe 都能调用；无手势/频率限制就能反复拉起系统浏览器。
test("window.open reaches the browser only right after real input, once per input", () => {
  const view = loadSiteView();
  view.open("https://example.com/spam");
  view.contents.emit("input-event", {}, { type: "mouseMove" });
  view.contents.emit("input-event", {}, { type: "mouseWheel" });
  view.open("https://example.com/spam");
  assert.deepEqual(view.external, [], "no click or key: a third-party frame cannot raise the browser");

  view.click("mouseDown");
  view.click("mouseUp");
  view.open("https://example.com/cited");
  view.open("https://example.com/spam");
  assert.deepEqual(view.external, ["https://example.com/cited"], "one input, one hand-off");
  view.click("rawKeyDown");
  view.open("https://example.com/by-keyboard");
  assert.deepEqual(view.external, ["https://example.com/cited", "https://example.com/by-keyboard"]);
});

test("the input grant expires", () => {
  let now = 1_000;
  const gate = new ExternalOpenGate(10_000, () => now);
  assert.equal(gate.take(), false);
  gate.noteInput("mouseDown");
  now += 10_000;
  assert.equal(gate.take(), true, "inclusive at the window edge");
  gate.noteInput("touchStart");
  now += 10_001;
  assert.equal(gate.take(), false);
  gate.noteInput(undefined);
  assert.equal(gate.take(), false);
});

// R17：同站 window.open 改写进本视图用的是 `void contents.loadURL()`，拒绝没人接。
test("a rejected same-site window.open rewrite does not become an unhandled rejection", async () => {
  const unhandled: unknown[] = [];
  const record = (reason: unknown) => unhandled.push(reason);
  process.on("unhandledRejection", record);
  try {
    const view = loadSiteView({ loadURL: () => Promise.reject(Object.assign(new Error("ERR_ABORTED"), { errno: -3 })) });
    assert.equal(view.open("https://claude.ai/chat/1").action, "deny");
    assert.deepEqual(view.loads, ["https://claude.ai/chat/1"], "same-site targets still replace the guarded view");
    await new Promise(done => setImmediate(done));
    await new Promise(done => setImmediate(done));
    assert.equal(unhandled.length, 0);
  } finally { process.off("unhandledRejection", record); }
});

test("a refused same-tab link leaves the page ready instead of loading forever", () => {
  const view = loadSiteView();
  view.contents.emit("did-start-navigation", { url: "https://claude.ai/new", isMainFrame: true, isSameDocument: false });
  view.contents.emit("did-finish-load");
  view.phases.length = 0;
  view.click();
  assert.equal(view.navigate("http://example.com/cited"), true);
  assert.deepEqual(view.phases, ["loading", "ready"], "the old document is still there and must read as ready");
  assert.equal(view.navigate("https://claude.ai/chat/next"), false, "allowed navigations still load normally");
  assert.deepEqual(view.phases, ["loading", "ready", "loading"]);
});
