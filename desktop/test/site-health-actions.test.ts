import assert from "node:assert/strict";
import test from "node:test";
import type { PolyAskDesktopApi } from "../src/preload/shell";
import { getCopy } from "../src/shared/copy";
import { REPORT_PROXY_STATE_TIMEOUT_MS, siteHealthActions } from "../src/renderer/site-health-actions";
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

test("a hung proxy-state read is abandoned after the timeout and the report still copies without a proxy line", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  let clipboard = "";
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { platform: "Win32",
    clipboard: { writeText: async (text: string) => { clipboard = text; } } } });
  Object.defineProperty(globalThis, "window", { configurable: true, value: { devicePixelRatio: 1 } });
  const cleared = t.mock.method(globalThis, "clearTimeout");
  let hang = true;
  setShellApi({ getRuntimeProcessFailures: async () => [], getCaptureLocateCounts: async () => ({}),
    getProxyState: () => hang ? new Promise(() => {}) : Promise.resolve({ formValue: { mode: "direct", scheme: "http", username: "" },
      following: false, appliedResult: "ok", stored: "ok", pending: false, pendingConfirm: null, secret: "none" })
  } as unknown as PolyAskDesktopApi);
  try {
    const copy = getCopy("zh-CN");
    const notes: string[] = [];
    const actions = siteHealthActions({ copy, sites: [], selected: new Set(),
      runtime: { version: "1.20.0", distribution: "installed" } as any, statuses: {}, health: {},
      setHealth() {}, noteHealth: text => notes.push(text) });
    const pending = actions.onCopyHealthReport();
    for (let i = 0; i < 10; i++) await Promise.resolve();
    assert.equal(clipboard, "", "超时前仍在等待");
    t.mock.timers.tick(REPORT_PROXY_STATE_TIMEOUT_MS);
    await pending;
    assert.match(clipboard, /^PolyAsk Desktop 1\.20\.0/);
    assert.doesNotMatch(clipboard, /^proxy /m);
    assert.equal(notes.at(-1), copy.healthReportCopied);
    hang = false;
    clipboard = "";
    await actions.onCopyHealthReport();
    assert.match(clipboard, /\nproxy mode=direct /);
    assert.ok(cleared.mock.callCount() >= 2, "超时路径与正常路径都清除了定时器");
  } finally {
    setShellApi(null);
    if (originalNavigator) Object.defineProperty(globalThis, "navigator", originalNavigator);
    else Reflect.deleteProperty(globalThis, "navigator");
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }
});

test("snapshot export action reports exported/failed states, stays silent on cancel, and guards concurrent clicks", async () => {
  const notes: string[] = [];
  let calls = 0;
  let releaseGate: (() => void) | undefined;
  let nextResult: any = { status: "exported", filePath: "/tmp/kimi-dom-snapshot-2026-11-14.json" };
  setShellApi({
    exportSiteSnapshot: async () => {
      calls += 1;
      if (releaseGate) await new Promise<void>((resolve) => { releaseGate = resolve; });
      if (nextResult instanceof Error) throw nextResult;
      return nextResult;
    }
  } as unknown as PolyAskDesktopApi);
  try {
    const copy = getCopy("zh-CN");
    const actions = siteHealthActions({
      copy,
      sites: [{ key: "kimi", label: "Kimi" } as any],
      selected: new Set(["kimi" as const]),
      runtime: { version: "1.34.0", distribution: "installed" } as any,
      statuses: {},
      health: {},
      setHealth() {},
      noteHealth: (text) => notes.push(text)
    });

    releaseGate = () => {};
    const first = actions.onExportSiteSnapshot("kimi");
    await actions.onExportSiteSnapshot("kimi");
    assert.equal(calls, 1, "导出进行中再次点击不应重复重入");
    releaseGate();
    releaseGate = undefined;
    await first;
    assert.match(notes.at(-1) ?? "", /Kimi.*脱敏结构快照/);

    const countBeforeCancel = notes.length;
    nextResult = { status: "cancelled" };
    await actions.onExportSiteSnapshot("kimi");
    assert.equal(notes.length, countBeforeCancel, "取消保存对话框不应报错或刷提示");

    nextResult = { status: "failed", code: "snapshot_privacy_blocked" };
    await actions.onExportSiteSnapshot("kimi");
    assert.equal(notes.at(-1), copy.snapshotPrivacyBlocked);

    nextResult = new Error("Error invoking remote method 'polyask:export-site-snapshot': Error: snapshot_too_large");
    await actions.onExportSiteSnapshot("kimi");
    assert.equal(notes.at(-1), copy.snapshotTooLarge);
  } finally {
    setShellApi(null);
  }
});
