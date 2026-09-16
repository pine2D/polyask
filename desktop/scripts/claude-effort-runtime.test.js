#!/usr/bin/env node
"use strict";
// Claude effort 子菜单的档位回归（think 取最高档、fast 回默认档、双层语义校验、入口缺失 fail-closed）。
// 从 intl-runtime.test.js 拆出（那份撞 300 行）；模型正则与 state() 的对账在 claude-model.test.js。
const assert = require("node:assert/strict");
const vm = require("node:vm");
const { source, fakeRuntime } = require("./lib/intl-harness");

// —— Claude effort 子菜单（2026-08-31：effort-menu-trigger / effort-option-* 两个 testid 全没了）——
function claudeEffortCase(options) {
  const opts = options || {};
  const clicked = [];
  const attr = (map) => ({ getAttribute: (name) => (name in map ? map[name] : null) });
  const state = { label: "Model: Fable 5 · Medium" };
  const menu = (lb) => ({ getAttribute: (name) => (name === "aria-labelledby" ? lb : null) });
  const modelMenu = menu("model-lb"), effortMenu = menu("eff-1");
  const radio = (text, home, checked) => ({ textContent: text, closest: () => home,
    getAttribute: (name) => (name === "aria-checked" ? String(!!checked) : null) });
  // 「Max Preview」是刻意放的诱饵模型：文本命中档位标签集，但不属于 effort 子菜单容器。
  // 只按文本过滤就会把它当最高档点下去 —— 双重语义校验的第二层就是防它。
  const models = [radio("Fable 5", modelMenu), radio("Max Preview", modelMenu), radio("Sonnet 5", modelMenu, true)];
  const tiers = (opts.tiers || ["Low", "MediumDefault", "High", "Extra", "Max"])
    .map((name) => radio(name, effortMenu));
  const trigger = Object.assign({ textContent: "EffortMedium", id: opts.id === undefined ? "eff-1" : opts.id }, attr({ "aria-haspopup": "menu" }));
  let expanded = !!opts.expanded;
  const document = {
    querySelector: (selector) => selector === '[data-testid="model-selector-dropdown"]'
      ? { getAttribute: (name) => (name === "aria-label" ? state.label : null) }
      : (selector === '[role="menuitemradio"]' ? models[0] : null),
    querySelectorAll: (selector) => {
      if (selector === '[role="menuitemradio"]') return expanded ? models.concat(tiers) : models;
      if (selector === '[role="menuitem"][aria-haspopup="menu"]') return opts.dropEntry ? [] : [trigger];
      return [];
    },
  };
  const S = fakeRuntime(document, clicked, (el) => { if (el === trigger) expanded = true; });
  S.clickEl = (el) => { clicked.push(el); state.label = "Model: Fable 5 · " + (el.textContent || ""); return true; };
  vm.runInNewContext(source("adapters-intl.js"), { window: { __AMS: S }, t: (key) => key, document, console });
  return { adapter: S.adapters["claude.ai"], S, clicked, tiers, models, state };
}

// think 取已知序列里在场的最高档；站点减档时自动退到次高档，而不是写死 High
async function claudeEffortMustTakeHighestKnownTier() {
  for (const [tiers, wanted] of [[null, "Max"], [["Low", "MediumDefault", "High", "Extra"], "Extra"], [["Low", "High"], "High"],
    [["低", "中", "高", "超", "极致"], "极致"], [["低", "中", "高", "超"], "超"]]) { // 中文 UI：点到的档名 _THINK 也必须能复读
    const c = claudeEffortCase({ tiers: tiers });
    await c.adapter._setEffort();
    const picked = c.clicked.filter((el) => c.tiers.includes(el)).map((el) => el.textContent);
    assert.deepEqual(picked, [wanted], "必须取在场最高档：" + JSON.stringify(tiers));
    assert.equal(c.adapter.state(), "think", "切完必须能被 state() 判成 think");
    assert.equal(c.S.escCount, 1, "选档后必须 escMenus 收尾");
  }
}

// fast 回到默认档（Medium）：effort 是站点级记忆，只换模型不回档会把上一轮 think 的 Max 带给 Sonnet（用户真机 2026-09-16）。
// 没有 Medium 必须抛错，不许退到最低档或最高档。
async function claudeFastMustTakeDefaultTier() {
  for (const [tiers, wanted] of [[null, "MediumDefault"], [["Low", "MediumDefault", "High", "Extra", "Max"], "MediumDefault"],
    [["低", "中", "高", "超", "极致"], "中"]]) {
    const c = claudeEffortCase({ tiers: tiers });
    await c.adapter._setEffort("default");
    const picked = c.clicked.filter((el) => c.tiers.includes(el)).map((el) => el.textContent);
    assert.deepEqual(picked, [wanted], "必须取默认档：" + JSON.stringify(tiers));
    assert.equal(c.S.escCount, 1, "选档后必须 escMenus 收尾");
  }
  const none = claudeEffortCase({ tiers: ["Low", "High"] });
  await assert.rejects(async () => none.adapter._setEffort("default"), /默认档/);
  assert.equal(none.clicked.length, 0, "没有默认档时一项都不许点");
}

// 档位项与模型项同为 menuitemradio：容器不对的「Max Preview」绝不能被当成最高档点下去
async function claudeEffortMustIgnoreModelRadios() {
  const c = claudeEffortCase({ tiers: [] }); // 子菜单展开了但一个档位都没有
  await assert.rejects(async () => c.adapter._setEffort());
  assert.ok(!c.clicked.some((el) => c.models.includes(el)), "绝不能点到模型 radio（含诱饵 Max Preview）");
}

// 入口没有 id 时双层校验会退化成纯文本匹配，诱饵「Max Preview」就会被当最高档点下去：必须 fail-closed 抛错
async function claudeEffortWithoutTriggerIdMustThrow() {
  const c = claudeEffortCase({ id: "" });
  await assert.rejects(async () => c.adapter._setEffort(), /缺少 id/);
  assert.ok(!c.clicked.some((el) => c.models.includes(el)), "id 缺失时绝不能点到任何模型 radio（含诱饵 Max Preview）");
  assert.ok(!c.clicked.some((el) => c.tiers.includes(el)), "id 缺失时也不得点档位项——归属无法校验");
}

// 入口整个不见了必须抛 —— 2026-08-31 起撤销「无 effort 入口静默 return」那条例外
async function claudeMissingEffortMustThrow() {
  const c = claudeEffortCase({ dropEntry: true });
  await assert.rejects(async () => c.adapter._setEffort());
  assert.equal(c.clicked.length, 0, "找不到 effort 入口时不得点击任何项");
}

let failed = 0;
(async () => {
  const tests = [claudeEffortMustTakeHighestKnownTier, claudeFastMustTakeDefaultTier, claudeEffortMustIgnoreModelRadios,
    claudeEffortWithoutTriggerIdMustThrow, claudeMissingEffortMustThrow];
  for (const test of tests) {
    try { await test(); }
    catch (error) { failed++; console.error(error.stack || error); }
  }
  if (failed) process.exitCode = 1;
  else console.log("✓ Claude effort：think 最高档、fast 默认档、语义校验与 fail-closed");
})();
