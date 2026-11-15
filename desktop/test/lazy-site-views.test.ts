import assert from "node:assert/strict";
import test from "node:test";
import { readSource } from "./fixtures";
import { ensureSiteViews } from "../src/main/ensure-site-views";
import type { SiteKey } from "../src/shared/contracts";

const manager = readSource("src/main/view-manager.ts");
const viewTree = readSource("src/main/site-view-tree.ts");
const sliceTree = (name: string): string => {
  const start = viewTree.indexOf(`\n  ${name}(`);
  assert.ok(start > 0, `${name} 不存在`);
  return viewTree.slice(start, viewTree.indexOf("\n  }", start));
};

// 此前 `for (const site of SITES) this.createView(site)` 无条件把九个站点全部建出来并加载完整 SPA，
// 于是「少勾站点」根本不省内存（真机实测单站平均约 250MB 工作集）。
test("views are created for the selection, never for the whole catalogue", () => {
  assert.ok(!/for \(const site of SITES\) this\.createView/.test(manager + viewTree),
    "构造期不得再无条件为九站建视图——那正是「少勾也不省内存」的根因");
  assert.match(manager, /this\.viewTree\.initialize\(\)/);
  assert.match(viewTree, /ensureSiteViews\(this\.deps\.workspace\.selected, this\.views,/);
  const created: SiteKey[] = [];
  const views = new Map<SiteKey, unknown>([["claude", {}]]);
  ensureSiteViews(["claude", "kimi"], views, site => { created.push(site.key); views.set(site.key, {}); });
  assert.deepEqual(created, ["kimi"], "只建立缺失的已打开页面，不重建已有会话或预加载其它站点");
  ensureSiteViews(["claude", "kimi"], views, site => created.push(site.key));
  assert.deepEqual(created, ["kimi"], "重复协调复用已有视图");
});

test("both halves run on every reconcile so the state self-heals", () => {
  const reconcile = sliceTree("reconcileViews");

  // 布局操作也执行释放检查；状态/采集完成后的自动回收另有行为回归。
  assert.match(reconcile, /ensureSiteViews\(this\.deps\.workspace\.selected, this\.views,/);
  assert.match(reconcile, /this\.deps\.releaseUnselectedViews\(\);/);
});

test("selection changes go through reconcile, not a bespoke path", () => {
  const selection = manager.slice(manager.indexOf("setSelection("), manager.indexOf("setPage("));

  assert.match(selection, /this\.viewTree\.reconcileViews\(\)/,
    "setSelection 必须经 reconcileViews，新勾选的站点才会被建出来");
});
