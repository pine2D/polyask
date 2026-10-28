import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { readSource } from "./fixtures";
import { confirmAndStartNewSession } from "../src/renderer/new-session-action";
import { getCopy } from "../src/shared/copy";
import { NativePanelFocus } from '../src/main/native-panel-focus';

// 执行 App 的真实入口；只替换 Electron/React 边界，覆盖确认前后的原生视图切换时序。
for (const approved of [false, true]) {
  test(`new session exposes confirmation and restores sites on ${approved ? "accept" : "cancel"}`, async () => {
    const app = readSource("src/renderer/index.tsx");
    const body = app.slice(app.indexOf("  const startNewSession ="), app.indexOf("  const showGroupMenu ="));
    const events: string[] = [];
    let pending: { count: number; decide: (ok: boolean) => void } | null = null;
    const context = vm.createContext({
      selected: new Set(["claude", "chatgpt", "deepseek"]),
      participation: { pending: false, currentSites: () => ["claude", "chatgpt", "deepseek"] },
      newSessionInFlight: { current: false }, actionLock: { current: { busy: false } },
      pendingNewSession: null, runState: "idle", auxiliaryBusy: false,
      draftConfirmation: { isBlocking: () => false },
      changeSurface: (surface: string) => events.push(surface),
      setPendingNewSession: (value: typeof pending) => { pending = value; },
      confirmAndStartNewSession,
      runAuxiliary: (action: () => Promise<void>) => action(),
      broadcast: { invalidate() {} }, archiveCapture: { invalidate() {} },
      runProgress: { invalidate: () => events.push("invalidate-progress") },
      shell: { newSession: async (sites: string[]) => { events.push("new-session"); assert.deepEqual([...sites], ["claude", "chatgpt", "deepseek"]); return []; } },
      copy: getCopy("en"), setAnnouncement() {}, preferences: { confirmations: { newSessionConfirm: true } },
      workspaceFlow: { recover: () => assert.fail("unexpected failure") }
    });
    const script = ts.transpileModule(`${body}\nstartNewSession();`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
    const result = vm.runInContext(script, context) as Promise<void>;
    assert.deepEqual(events, ["confirmation"], "站点原生视图必须先让出确认框");
    assert.equal(pending!.count, 3);
    const original = pending;
    // React has not rendered the pending state yet: the second call must still be blocked.
    const repeated = vm.runInContext("startNewSession()", context);
    assert.equal(pending === original, true, "重复调用不得替换仍在等待的确认");
    pending!.decide(approved);
    await Promise.all([result, repeated]);
    assert.deepEqual(events, approved ? ["confirmation", "sites", "invalidate-progress", "new-session"] : ["confirmation", "sites"]);
    assert.equal(pending, null);
  });
}

test("new session skips the dialog after don't ask again without bypassing busy guards", async () => {
  const app = readSource("src/renderer/index.tsx");
  const body = app.slice(app.indexOf("  const startNewSession ="), app.indexOf("  const showGroupMenu ="));
  const events: string[] = [];
  const context = vm.createContext({
    selected: new Set(["claude", "kimi", "chatgpt", "deepseek", "gemini"]),
    participation: { pending: false, currentSites: () => ["claude", "kimi"] },
    newSessionInFlight: { current: false }, actionLock: { current: { busy: false } }, pendingNewSession: null, runState: "idle", auxiliaryBusy: false,
    draftConfirmation: { isBlocking: () => false },
    changeSurface: (surface: string) => events.push(surface),
    setPendingNewSession: () => assert.fail("no confirmation after don't ask again"),
    confirmAndStartNewSession, runAuxiliary: (action: () => Promise<void>) => action(),
    broadcast: { invalidate() {} }, archiveCapture: { invalidate() {} }, runProgress: { invalidate() {} },
    shell: { newSession: async (sites: string[]) => { events.push(`new-session:${[...sites].join(",")}`); return []; } },
    copy: getCopy("en"), setAnnouncement() {}, preferences: { confirmations: { newSessionConfirm: false } },
    workspaceFlow: { recover: () => assert.fail("unexpected failure") }
  });
  const script = ts.transpileModule(`${body}\nstartNewSession();`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  await vm.runInContext(script, context);
  assert.deepEqual(events, ["new-session:claude,kimi"], "站点视图不让位、不弹确认，直接新建");
  context.runState = "sending";
  await vm.runInContext("startNewSession()", context);
  assert.equal(events.length, 1, "忙碌保护不因不再提示而失效");
});

test("a pending auxiliary operation cannot be covered by a new-session confirmation", async () => {
  const app = readSource("src/renderer/index.tsx");
  const body = app.slice(app.indexOf("  const startNewSession ="), app.indexOf("  const showGroupMenu ="));
  let opened = false;
  const script = ts.transpileModule(`${body}\nstartNewSession();`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  await vm.runInNewContext(script, {
    pendingNewSession: null, runState: "idle", auxiliaryBusy: true,
    draftConfirmation: { isBlocking: () => false },
    selected: new Set(["claude"]),
    setPendingNewSession() {}, changeSurface() {},
    confirmAndStartNewSession: async () => { opened = true; }
  });
  assert.equal(opened, false, "辅助综合完成时会切换界面，不能把未决确认框卸载后留在锁定状态");
});

test("confirmation surface reaches the manager only through a trusted shell and takes keyboard focus", () => {
  const source = readSource("src/main/shell-panel-ipc.ts");
  const body = source.slice(source.indexOf("  ipc.on('polyask:set-surface'"), source.indexOf("  ipc.on('polyask:set-drawer-open'"));
  let handler: (event: { trusted: boolean }, value: unknown) => void;
  const events: string[] = [];
  vm.runInNewContext(ts.transpileModule(body, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, {
    ipc: { on: (_channel: string, callback: typeof handler) => { handler = callback; } },
    trusted: (event: { trusted: boolean }) => event.trusted,
    manager: { setSurface: (surface: string) => events.push(surface) },
    focus: new NativePanelFocus({ capture: () => null, activate: () => events.push("focus-shell"), restore: () => false })
  });
  handler!({ trusted: false }, "confirmation");
  handler!({ trusted: true }, "invalid");
  handler!({ trusted: true }, ["confirmation"]);
  assert.deepEqual(events, []);
  handler!({ trusted: true }, "confirmation");
  assert.deepEqual(events, ["confirmation", "focus-shell"]);
  handler!({ trusted: true }, "sites");
  assert.deepEqual(events, ["confirmation", "focus-shell", "sites"]);
});
