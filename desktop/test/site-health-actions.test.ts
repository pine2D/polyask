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

test("copy action appends the proxy line from proxy-state and omits it when proxy-state cannot be read", async () => {
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  let clipboard = "", proxyFails = false;
  const notes: string[] = [];
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { platform: "Win32",
    clipboard: { writeText: async (text: string) => { clipboard = text; } } } });
  Object.defineProperty(globalThis, "window", { configurable: true, value: { devicePixelRatio: 1 } });
  const value = { version: 1, mode: "custom", scheme: "https", host: "proxy.private.invalid", port: 8443,
    bypass: ["*.private.invalid"], username: "private-user" };
  setShellApi({ getRuntimeProcessFailures: async () => [], getCaptureLocateCounts: async () => ({}),
    getProxyState: async () => {
      if (proxyFails) throw new Error("ipc_failure");
      return { applied: value, blocked: false, stored: "ok", appliedResult: "ok", pending: false, pendingConfirm: null,
        following: true, formValue: value, secret: "memory", encryption: false, linuxDesktopProxy: null };
    } } as unknown as PolyAskDesktopApi);
  try {
    const copy = getCopy("zh-CN");
    const actions = siteHealthActions({ copy, sites: [], selected: new Set(),
      runtime: { version: "1.20.0", distribution: "installed" } as any, statuses: {}, health: {},
      setHealth() {}, noteHealth: text => notes.push(text) });
    await actions.onCopyHealthReport();
    assert.match(clipboard, /\nproxy mode=custom scheme=https auth=yes secret=memory following=yes applied=ok pending=no confirm=no stored=ok(\n|$)/);
    assert.doesNotMatch(clipboard, /private|8443/, "代理主机、端口、用户名与绕过列表不进报告");
    assert.equal(notes.at(-1), copy.healthReportCopied);
    proxyFails = true;
    clipboard = "";
    await actions.onCopyHealthReport();
    assert.match(clipboard, /^PolyAsk Desktop 1\.20\.0/, "proxy-state 读不到时省略该行，报告照常复制");
    assert.doesNotMatch(clipboard, /^proxy /m);
    assert.equal(notes.at(-1), copy.healthReportCopied);
  } finally {
    setShellApi(null);
    if (originalNavigator) Object.defineProperty(globalThis, "navigator", originalNavigator);
    else Reflect.deleteProperty(globalThis, "navigator");
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }
});
