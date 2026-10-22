import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { EventEmitter } from "node:events";
import ts from "typescript";
import { disableWebBadging } from "../src/main/web-badging";
import { SITE_VIEW_SECURITY } from "../src/main/diagnostics";
import { readSource } from "./fixtures";

function compile(path: string): string {
  return ts.transpileModule(readSource(path), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText;
}

test("badge calls resolve without touching the native badge or exposing capabilities", async () => {
  for (const supported of [true, false]) {
    let nativeCalls = 0;
    const prototype = supported ? { setAppBadge: () => { nativeCalls++; }, clearAppBadge: () => { nativeCalls++; } } : {};
    const mainWorld = vm.createContext({ navigator: Object.create(prototype) });
    const isolatedWorld = vm.createContext({ exports: {}, require: () => ({ contextBridge: {
      executeInMainWorld: ({ func }: { func: () => void }) => vm.runInContext(`(${func.toString()})()`, mainWorld)
    } }) });
    vm.runInContext(compile("src/preload/web-badging.ts"), isolatedWorld);
    if (supported) {
      for (const call of ["navigator.setAppBadge(2)", "navigator.setAppBadge()", "navigator.clearAppBadge()",
        "Object.getPrototypeOf(navigator).setAppBadge.call(navigator, 9)"]) {
        const result = vm.runInContext(call, mainWorld);
        assert.equal(typeof result.then, "function");
        assert.equal(await result, undefined);
      }
      assert.equal(nativeCalls, 0);
      assert.equal(vm.runInContext("Reflect.deleteProperty(Object.getPrototypeOf(navigator),'setAppBadge')", mainWorld), false);
    } else assert.equal(vm.runInContext("'setAppBadge' in navigator", mainWorld), false);
    assert.equal(vm.runInContext("typeof require", mainWorld), "undefined");
    assert.equal(vm.runInContext("typeof process", mainWorld), "undefined");
  }
});

test("every new session gets the worker preload before any worker starts", () => {
  const app = new EventEmitter();
  const registrations: { type: string; filePath: string }[] = [];
  disableWebBadging(app as unknown as Parameters<typeof disableWebBadging>[0], "/preload/badge.js");
  for (let i = 0; i < 2; i++) app.emit("session-created", {
    registerPreloadScript: (entry: { type: string; filePath: string }) => registrations.push(entry)
  });
  assert.deepEqual(registrations, Array.from({ length: 2 }, () => ({ type: "service-worker", filePath: "/preload/badge.js" })));
});

test("subframes only receive the badge policy, never site adapters or command IPC", () => {
  for (const isMainFrame of [true, false]) {
    const loaded: string[] = [];
    vm.runInNewContext(compile("src/preload/site-entry.ts"), {
      exports: {}, process: { isMainFrame }, require: (module: string) => loaded.push(module)
    });
    assert.deepEqual(loaded, isMainFrame ? ["./web-badging", "./site"] : ["./web-badging"]);
  }
  assert.equal(SITE_VIEW_SECURITY.nodeIntegrationInSubFrames, true);
  assert.equal(SITE_VIEW_SECURITY.nodeIntegration, false);
  assert.equal(SITE_VIEW_SECURITY.sandbox, true);
  const config = readSource("forge.config.ts");
  assert.match(config, /preload: \{ js: "\.\/src\/preload\/site-entry\.ts" \}/);
  assert.match(config, /name: "web_badging",\s+preload: \{ js: "\.\/src\/preload\/web-badging\.ts" \}/);
});

test("web badging is disabled at startup before any browser context is created", () => {
  const main = readSource("src/main/index.ts");
  const call = main.indexOf("\ndisableWebBadging(app, WEB_BADGING_PRELOAD_WEBPACK_ENTRY);\n");
  assert.ok(call > 0, "apply the policy at module top level");
  assert.ok(main.indexOf("app.whenReady(") > call, "apply it before Chromium starts");
  assert.ok(main.indexOf("new BrowserWindow(") > call, "apply it before a window exists");
});
