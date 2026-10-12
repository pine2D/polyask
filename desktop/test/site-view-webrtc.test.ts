import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import test from "node:test";
import { transformSync } from "esbuild";

import { readSource } from "./fixtures";
import { viewManagerHarness } from "./view-manager-harness";

type Policy = "default" | "disable_non_proxied_udp";

// 真实 createSiteView 跑在桩 WebContentsView 上（同 site-external-links.test.ts），只换掉 Electron 本身。
function siteViewFactory() {
  const require = createRequire(resolve(__dirname, "../src/main/site-view.ts"));
  const created: string[][] = [];
  let nextId = 1;
  class FakeView {
    readonly webContents: EventEmitter;
    constructor() {
      const calls: string[] = [];
      created.push(calls);
      this.webContents = Object.assign(new EventEmitter(), {
        id: nextId++, isDestroyed: () => false, getURL: () => "https://claude.ai/new",
        getBackgroundThrottling: () => false, setBackgroundThrottling() {}, reload() {},
        setWindowOpenHandler() {},
        loadURL: async (url: string) => { calls.push(`load:${url}`); },
        setWebRTCIPHandlingPolicy: (policy: string) => { calls.push(`webrtc:${policy}`); }
      });
    }
  }
  const module = { exports: {} as any };
  runInNewContext(transformSync(readSource("src/main/site-view.ts"), { loader: "ts", format: "cjs" }).code, {
    module, exports: module.exports, SITE_WINDOW_PRELOAD_WEBPACK_ENTRY: "preload.js",
    require: (name: string) => name === "electron" ? { WebContentsView: FakeView } : require(name)
  });
  const site = require("./sites").SITES.find((candidate: { key: string }) => candidate.key === "claude");
  const noop = () => {};
  const create = (policy: () => Policy) => module.exports.createSiteView(site,
    { onLoading: noop, onReady: noop, onFailure: noop, onCrash: noop, onExternal: noop, webrtcPolicy: policy });
  return { created, create };
}

test("a new site view takes the current WebRTC policy before anything can load", () => {
  const h = siteViewFactory();
  let policy: Policy = "disable_non_proxied_udp";
  h.create(() => policy);
  policy = "default";
  h.create(() => policy);
  assert.deepEqual(h.created, [["webrtc:disable_non_proxied_udp"], ["webrtc:default"]],
    "read at creation (not cached), and createSiteView itself never loads a page");
});

test("ViewManager hands site views the live proxy policy", () => {
  let policy: Policy = "default";
  const h = viewManagerHarness({ options: { webrtcPolicy: () => policy } });
  assert.equal(h.views[0].callbacks.webrtcPolicy(), "default");
  policy = "disable_non_proxied_udp";
  assert.equal(h.views[0].callbacks.webrtcPolicy(), "disable_non_proxied_udp", "a view recreated later reads the new policy");
});

test("an unwired ViewManager falls back to Electron's default WebRTC policy", () => {
  const h = viewManagerHarness();
  assert.equal(h.views[0].callbacks.webrtcPolicy(), "default");
});
