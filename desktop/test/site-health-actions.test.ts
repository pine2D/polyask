import assert from "node:assert/strict";
import test from "node:test";
import type { PolyAskDesktopApi } from "../src/preload/shell";
import { getCopy } from "../src/shared/copy";
import { siteHealthActions } from "../src/renderer/site-health-actions";
import { setShellApi } from "../src/renderer/shell-api";

test("copy action fetches runtime diagnostics and reports success or failure accurately", async () => {
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  let clipboard = "", failed = false;
  const notes: string[] = [];
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { platform: "Win32",
    clipboard: { writeText: async (text: string) => { clipboard = text; } } } });
  Object.defineProperty(globalThis, "window", { configurable: true, value: { devicePixelRatio: 1 } });
  let locateFails = false;
  setShellApi({ getRuntimeProcessFailures: async () => {
    if (failed) throw new Error("ipc_failure");
    return [{ processType: "GPU", reason: "launch-failed", systemErrorCode: 5 }];
  }, getCaptureLocateCounts: async () => {
    if (locateFails) throw new Error("ipc_failure");
    return { kimi: { anchor: 2 } };
  } } as unknown as PolyAskDesktopApi);
  try {
    const copy = getCopy("zh-CN");
    const actions = siteHealthActions({ copy, sites: [{ key: "kimi", label: "Kimi" } as any], selected: new Set(["kimi" as const]),
      runtime: { version: "1.10.1", distribution: "installed" } as any, statuses: {}, health: {},
      setHealth() {}, noteHealth: text => notes.push(text) });
    await actions.onCopyHealthReport();
    assert.match(clipboard, /runtime \[GPU\]: reason=launch-failed systemErrorCode=5/);
    assert.match(clipboard, /\n  capture-locate anchor=2(\n|$)/);
    assert.equal(notes.at(-1), copy.healthReportCopied);
    locateFails = true;
    clipboard = "";
    await actions.onCopyHealthReport();
    assert.match(clipboard, /runtime \[GPU\]/, "定位记账读不到时省略该行，报告照常复制");
    assert.doesNotMatch(clipboard, /capture-locate/);
    failed = true;
    clipboard = "";
    await actions.onCopyHealthReport();
    assert.equal(clipboard, "");
    assert.equal(notes.at(-1), copy.healthReportCopyFailed);
  } finally {
    setShellApi(null);
    if (originalNavigator) Object.defineProperty(globalThis, "navigator", originalNavigator);
    else Reflect.deleteProperty(globalThis, "navigator");
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }
});
