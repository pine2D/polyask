import assert from "node:assert/strict";
import test from "node:test";
import type { MenuItemConstructorOptions } from "electron";

import { applicationMenu } from "../src/main/application-menu";
import { runViewMenuAction, type ViewMenuTarget } from "../src/main/view-menu-actions";
import { COPY } from "../src/shared/copy";
import { DEFAULT_DISPLAY_PREFERENCES } from "../src/shared/display";
import { SITE_ZOOM_SHORTCUTS } from "../src/shared/site-zoom";
import { viewManagerHarness } from "./view-manager-harness";

const flatten = (items: MenuItemConstructorOptions[]): MenuItemConstructorOptions[] =>
  items.flatMap(item => [item, ...flatten(Array.isArray(item.submenu) ? item.submenu : [])]);

// R2/R7：reload/forceReload role 直接重载获得焦点的 webContents——站点视图聚焦时绕过 ViewManager 的
// 发送/生成闸门、提交中导航保护与 20s 提交上限；zoom role 缩放外壳却不发 zoom-changed，原生站点视图错位。
test("the view menu reloads and zooms through app items instead of Electron roles", () => {
  for (const platform of ["darwin", "win32", "linux"] as const) {
    const actions: string[] = [];
    const menu = applicationMenu(platform, COPY.en, DEFAULT_DISPLAY_PREFERENCES, () => {}, () => {}, "PolyAsk",
      action => actions.push(action));
    const items = flatten(menu);
    for (const role of ["reload", "forceReload", "resetZoom", "zoomIn", "zoomOut"]) {
      assert.equal(items.some(item => item.role === role), false, `${platform}: role ${role} 绕过 ViewManager`);
    }
    const expected: Array<[string, string]> = [
      ["CmdOrCtrl+R", "reload"], ["Shift+CmdOrCtrl+R", "force-reload"],
      ...SITE_ZOOM_SHORTCUTS.map(item => [item.accelerator, `zoom-${item.action}`] as [string, string])
    ];
    for (const [accelerator, action] of expected) {
      const item = items.find(candidate => candidate.accelerator === accelerator);
      assert.ok(item?.label, `${platform}: ${accelerator} 必须显式写在菜单项上（速查读真实菜单）`);
      item.click?.({} as never, {} as never, {} as never);
      assert.equal(actions.at(-1), action);
    }
  }
});

function target(overrides: Partial<ViewMenuTarget> = {}) {
  const calls: string[] = [];
  const manager: ViewMenuTarget = {
    isConfirmationActive: () => false,
    owns: contents => (contents.id === 7 ? "chatgpt" : null),
    getLayout: () => ({ focused: "claude" }),
    reload: (site, ignoreCache) => { calls.push(`reload:${site}:${ignoreCache}`); return true; },
    relayout: () => calls.push("relayout"),
    siteZoom: { step: (site, action) => calls.push(`site-zoom:${site}:${action}`) },
    ...overrides
  };
  let level = 0;
  const shell = { id: 1, isDestroyed: () => false, getZoomLevel: () => level, setZoomLevel: (value: number) => { level = value; calls.push(`shell-zoom:${value}`); } };
  return { manager, shell, calls };
}

test("reload goes to the focused site view, or the layout's focused site when the shell has focus", () => {
  const site = { id: 7, isDestroyed: () => false };
  const t = target();
  runViewMenuAction("reload", t.manager, t.shell, site);
  runViewMenuAction("force-reload", t.manager, t.shell, t.shell);
  runViewMenuAction("reload", t.manager, t.shell, null);
  assert.deepEqual(t.calls, ["reload:chatgpt:false", "reload:claude:true", "reload:claude:false"],
    "外壳聚焦时 Ctrl+R 不再重载外壳本身，而是经 ViewManager 重载当前站点");

  const locked = target({ isConfirmationActive: () => true });
  assert.equal(runViewMenuAction("reload", locked.manager, locked.shell, site), false);
  assert.deepEqual(locked.calls, [], "确认框期间菜单不导航，与命令表同一道锁");
});

test("zoom steps the focused site through its controller, otherwise zooms the shell and relayouts", () => {
  const t = target();
  runViewMenuAction("zoom-in", t.manager, t.shell, { id: 7, isDestroyed: () => false });
  runViewMenuAction("zoom-in", t.manager, t.shell, t.shell);
  runViewMenuAction("zoom-out", t.manager, t.shell, t.shell);
  runViewMenuAction("zoom-out", t.manager, t.shell, t.shell);
  runViewMenuAction("zoom-reset", t.manager, t.shell, null);
  assert.deepEqual(t.calls, [
    "site-zoom:chatgpt:in",
    "shell-zoom:0.5", "relayout", "shell-zoom:0", "relayout", "shell-zoom:-0.5", "relayout", "shell-zoom:0", "relayout"
  ]);
});

test("shell zoom from the menu re-lays the native site views at the new zoom", () => {
  const h = viewManagerHarness();
  try {
    const before = h.bounds.at(-1)!;
    runViewMenuAction("zoom-in", h.manager, h.shell, h.shell);
    const after = h.bounds.at(-1)!;
    assert.notEqual(after.width, before.width, "外壳缩放后原生视图必须按新缩放重排，否则与外壳格子错位");
    runViewMenuAction("zoom-reset", h.manager, h.shell, h.shell);
    assert.equal(h.bounds.at(-1)!.width, before.width);
  } finally { h.window.emit("closed"); }
});

// R6：外壳重载后渲染层回到初值，主进程却还记着旧渲染层报来的 surface——确认框期间重载会让确认锁永不解除。
test("a new shell document resets the main-process mirror of renderer state", () => {
  const h = viewManagerHarness();
  try {
    h.manager.setSurface("confirmation");
    h.manager.historyAccess.setPanelOpen(true);
    h.manager.setComposerExpanded(true);
    assert.equal(h.manager.isConfirmationActive(), true);
    h.shell.emit("did-navigate", {}, "app://shell/index.html", 200, "OK");
    assert.equal(h.manager.isConfirmationActive(), false, "确认锁随旧渲染层一起解除，菜单快捷键恢复");
    assert.equal(h.manager.historyAccess.panelOpen, false);
    assert.equal(h.manager.navigateHistory("claude", -1), true, "导航命令不再被残留的确认锁吞掉");
  } finally { h.window.emit("closed"); }
});
