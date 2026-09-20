import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { readSource } from "./fixtures";

// 执行 App 的真实入口；只替换 Electron/React 边界，覆盖确认前后的原生视图切换时序。
for (const approved of [false, true]) {
  test(`new session exposes confirmation and restores sites on ${approved ? "accept" : "cancel"}`, async () => {
    const app = readSource("src/renderer/index.tsx");
    const body = app.slice(app.indexOf("  const startNewSession ="), app.indexOf("  const showGroupMenu ="));
    const events: string[] = [];
    let pending: { count: number; decide: (ok: boolean) => void } | null = null;
    const context = vm.createContext({
      selected: new Set(["claude", "chatgpt", "deepseek"]),
      pendingNewSession: null, runState: "idle", auxiliaryBusy: false,
      changeSurface: (surface: string) => events.push(surface),
      setPendingNewSession: (value: typeof pending) => { pending = value; },
      confirmNewSession: (...args: unknown[]) => require("../src/renderer/session-confirmation").confirmNewSession(...args),
      runAuxiliary: (action: () => Promise<void>) => action(),
      broadcast: { invalidate() {} }, archiveCapture: { invalidate() {} },
      shell: { newSession: async (sites: string[]) => { events.push("new-session"); assert.deepEqual([...sites], ["claude", "chatgpt", "deepseek"]); return []; } },
      copy: {}, formatCopy: () => "", setAnnouncement() {},
      workspaceFlow: { recover: () => assert.fail("unexpected failure") }
    });
    const script = ts.transpileModule(`${body}\nstartNewSession();`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
    const result = vm.runInContext(script, context) as Promise<void>;
    assert.deepEqual(events, ["confirmation"], "站点原生视图必须先让出确认框");
    assert.equal(pending!.count, 3);
    const original = pending;
    context.pendingNewSession = pending;
    await vm.runInContext("startNewSession()", context);
    assert.equal(pending, original, "重复调用不得替换仍在等待的确认");
    pending!.decide(approved);
    await result;
    assert.deepEqual(events, approved ? ["confirmation", "sites", "new-session"] : ["confirmation", "sites"]);
    assert.equal(pending, null);
  });
}

test("a pending auxiliary operation cannot be covered by a new-session confirmation", async () => {
  const app = readSource("src/renderer/index.tsx");
  const body = app.slice(app.indexOf("  const startNewSession ="), app.indexOf("  const showGroupMenu ="));
  let opened = false;
  const script = ts.transpileModule(`${body}\nstartNewSession();`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  await vm.runInNewContext(script, {
    pendingNewSession: null, runState: "idle", auxiliaryBusy: true,
    selected: new Set(["claude"]),
    setPendingNewSession() {}, changeSurface() {},
    confirmNewSession: async () => { opened = true; return false; }
  });
  assert.equal(opened, false, "辅助综合完成时会切换界面，不能把未决确认框卸载后留在锁定状态");
});

test("confirmation surface reaches the manager only through a trusted shell and takes keyboard focus", () => {
  const source = readSource("src/main/shell-ipc.ts");
  const body = source.slice(source.indexOf('  ipcMain.on("polyask:set-surface"'), source.indexOf('  ipcMain.on("polyask:set-layout"'));
  let handler: (event: { trusted: boolean }, value: unknown) => void;
  const events: string[] = [];
  vm.runInNewContext(ts.transpileModule(body, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, {
    ipcMain: { on: (_channel: string, callback: typeof handler) => { handler = callback; } },
    trustedShell: (event: { trusted: boolean }) => event.trusted,
    manager: { setSurface: (surface: string) => events.push(surface) },
    window: { webContents: { focus: () => events.push("focus-shell") } }
  });
  handler!({ trusted: false }, "confirmation");
  handler!({ trusted: true }, "invalid");
  assert.deepEqual(events, []);
  handler!({ trusted: true }, "confirmation");
  assert.deepEqual(events, ["confirmation", "focus-shell"]);
  handler!({ trusted: true }, "sites");
  assert.deepEqual(events, ["confirmation", "focus-shell", "sites"]);
});
