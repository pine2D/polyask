#!/usr/bin/env node
"use strict";

// site-runtime/adapters-cn2.js（智谱 / Kimi）与 adapters-cn3.js（元宝）的档位回归。2026-08-31 真机改版：
// 智谱弹层多出「模型段 + 极致档」、元宝多出 Models 子菜单、Kimi 的 escMenus 收不掉根菜单。
// scripts/cn2-send-runtime.test.js 只管这两卷的发送/附件语义，档位放这里，两边不重叠。
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = (file = "adapters-cn2.js") => fs.readFileSync(path.join(__dirname, "../src/site-runtime/" + file), "utf8");

function runtime(document, extra, file) {
  const S = {
    ...require("./lib/deadline-harness"), adapters: {}, sleep: async () => {}, escCount: 0, escMenus() { S.escCount++; },
    findByText: (selector, re, root) =>
      [...(root || document).querySelectorAll(selector)].find((n) => re.test((n.textContent || "").trim())) || null,
    waitFor: async (fn, timeout = 3500, step = 120) => {
      for (let waited = 0; ; waited += step) { const v = fn(); if (v) return v; if (waited >= timeout) return null; }
    },
    openMenu() {}, clickEl() { return true; },
  };
  // 覆盖必须发生在 vm 执行**之前**：适配器 IIFE 里 `const { openMenu, ... } = S` 会把引用解构走，
  // 事后改 S.openMenu 对它无效（会让断言变成假通过）。
  Object.assign(S, (extra && extra.hooks) || {});
  class FakeEvent { constructor(type, options) { this.type = type; Object.assign(this, options); } }
  vm.runInNewContext(source(file), Object.assign(
    { window: { __AMS: S }, t: (key) => key, document, console, MouseEvent: FakeEvent }, extra || {}));
  return S;
}

// —— 智谱：弹层 = 模型段（GLM-5.3 / GLM-Flash）+ 档位段（快速 / 深度 / 极致）——
function glmCase(options) {
  const opts = options || {};
  const clicked = [];
  const state = { open: false, selected: opts.selected || "快速" };
  const item = (name, submenu) => ({
    className: "think-mode-item" + (submenu ? " has-submenu" : "") + (state.selected === name ? " selected" : ""),
    querySelector: (selector) => (selector === ".item-name" ? { textContent: name } : null),
    getBoundingClientRect: () => ({ width: state.open ? 200 : 0, height: state.open ? 38 : 0 }),
    click() { clicked.push(name); if (!submenu) state.selected = name; },
    dispatchEvent() { return true; },
  });
  const names = ["GLM-5.3", "GLM-Flash"].concat(opts.tiers || ["快速", "深度", "极致"]);
  const trigger = { className: "think-mode-trigger", textContent: "GLM-Flash" + state.selected,
    click() { clicked.push("trigger"); state.open = !state.open; }, dispatchEvent() { return true; } };
  const document = {
    querySelector: (selector) => selector === ".think-mode-trigger" ? trigger
      : (selector === ".think-mode-item.has-submenu" ? item("快速", true) : null),
    // className 每次重算，才能反映 click 之后的 selected 迁移
    querySelectorAll: (selector) => {
      if (selector === ".think-mode-item") return names.map((n) => item(n, false));
      if (selector === ".think-mode-item:not(.has-submenu)") return names.map((n) => item(n, false));
      return [];
    },
  };
  const S = runtime(document);
  return { adapter: S.adapters["chatglm.cn"], S, clicked, state, trigger };
}

async function glmThinkMustPreferTopTier() {
  const c = glmCase({});
  await c.adapter.think();
  assert.ok(c.clicked.includes("极致"), "think 必须指向最强档「极致」，不是「深度」");
  assert.equal(c.adapter.state(), "think", "极致必须被 state() 判成 think");
}

// 站点撤掉「极致」时降级点「深度」，而不是抛错——深度仍是可用的思考档
async function glmThinkMustFallBackToDeep() {
  const c = glmCase({ tiers: ["快速", "深度"] });
  await c.adapter.think();
  assert.ok(c.clicked.includes("深度"), "没有极致时必须降级点深度");
  assert.equal(c.adapter.state(), "think", "深度同样判 think");
}

function glmStateMustAcceptBothThinkTiers() {
  for (const [selected, expected] of [["极致", "think"], ["深度", "think"], ["快速", "fast"], ["标准", null]])
    assert.equal(glmCase({ selected: selected, tiers: ["快速", "深度", "极致", "标准"] }).adapter.state(),
      expected, "智谱 state: " + selected);
}

// escMenus 关不掉 el-tooltip 弹层：收尾必须回点触发器，否则弹层罩住输入框让注入点空
async function glmMenuMustBeClosedByRetrigger() {
  const c = glmCase({});
  await c.adapter.think();
  assert.equal(c.state.open, false, "切完档弹层必须真的关掉");
  assert.ok(c.S.escCount >= 1, "先走 escMenus，再兜底点触发器");
}

// —— 元宝：「模型/Models」子菜单 + 模式项同为 menuitemradio（真机 2026-09-15：默认 Hy4 preview，且只剩专家模式）——
function yuanbaoCase(init, hooks) {
  const clicked = [];
  const state = Object.assign({ mode: "Expert", model: "Hy4 preview", modelsOpen: false }, init);
  // 真机 2026-08-31：模型列表那层菜单带 aria-label="Model list"，模式那层没有 aria-label
  const modeMenu = { getAttribute: () => null }, modelMenu = { getAttribute: (n) => (n === "aria-label" ? "Model list" : null) };
  const radio = (text, home, pick) => ({ textContent: text, closest: () => home, click() { clicked.push(text); pick(text); } });
  const allModes = ["InstantInstant answers for everyday tasks", "ThinkingDeep reasoning for tricky problems",
    "ExpertUse Tools and run tasks"];
  // Hy4 preview 下站点只给「专家」一项；点模式项只改模式
  const modes = () => (/^hy4/i.test(state.model) ? allModes.slice(2) : allModes)
    .map((t) => radio(t, modeMenu, (x) => { state.mode = x.split(/(?=[A-Z][a-z])/)[0]; }));
  // 「深度思考版」是刻意放的诱饵模型：文本命中模式标签集，靠容器（Model list）才能排掉它。
  // DeepSeek 那项的描述里也带「deep thinking」字样，Hy4 带「Expert mode only」。选中 Hy4 preview 站点会自动落到专家。
  const models = ["深度思考版Hy4 的思考特调", "Hy4 previewHandle complex tasks - Expert mode only",
    "Hy3Recommended for daily use", "DeepSeekSuitable for deep thinking"].map((t) => radio(t, modelMenu, (x) => {
      state.model = x.replace(/(Handle|Recommended|Suitable|Hy4 的).*$/, "").trim();
      if (/^hy4/i.test(state.model)) state.mode = "Expert";
    }));
  // 子菜单入口：文本 = Models + 当前模型名。真机 2026-09-16：只有合成 mousemove 能展开，click 不行——桩里照此建模
  const entry = { click() { clicked.push("Models:click"); },
    dispatchEvent(ev) { if (ev.type === "mousemove") { clicked.push("Models:hover"); state.modelsOpen = true; } } };
  Object.defineProperty(entry, "textContent", { get: () => "Models" + state.model });
  const button = { getAttribute: (name) => (name === "aria-label" ? "Switch model" : null) };
  Object.defineProperty(button, "textContent", { get: () => state.mode });
  const document = {
    querySelector: (selector) => (selector.includes("Switch model") ? button : null),
    querySelectorAll: (selector) => selector === '[role="menuitemradio"]' ? (state.modelsOpen ? models : []).concat(modes())
      : selector === '[role="menuitem"]' ? [entry] : [],
  };
  const S = runtime(document, hooks ? { hooks } : undefined, "adapters-cn3.js");
  return { adapter: S.adapters["yuanbao.tencent.com"], S, clicked, state };
}

// think = 模型 Hy4 preview。从 Hy3+即时出发：只点子菜单入口和 Hy4 preview 那一项，绝不碰诱饵「深度思考版」，
// 模式由站点自动落到专家，state 复读为 think。
async function yuanbaoThinkMustPickHy4Preview() {
  const c = yuanbaoCase({ mode: "Instant", model: "Hy3" });
  await c.adapter.think();
  assert.deepEqual(c.clicked, ["Models:hover", "Hy4 previewHandle complex tasks - Expert mode only"]);
  assert.equal(c.state.mode, "Expert");
  assert.equal(c.adapter.state(), "think");
}

// fast 从默认态（Hy4 preview + 专家）出发：菜单里没有「即时」，必须先把模型切回 Hy3 再选即时；
// 选即时时模型项仍在 DOM，只能点模式项，不能点模型项（语义校验）。
async function yuanbaoFastMustLeaveHy4PreviewFirst() {
  const c = yuanbaoCase({});
  await c.adapter.fast();
  assert.deepEqual(c.clicked, ["Models:hover", "Hy3Recommended for daily use", "InstantInstant answers for everyday tasks"]);
  assert.equal(c.adapter.state(), "fast");
  // 已在即时：不开菜单、不点任何东西
  c.clicked.length = 0;
  await c.adapter.fast();
  assert.deepEqual(c.clicked, []);
}

// openMenu 是切换语义：菜单已开时再点就把它关掉。真机 2026-09-01 实测，关闭动画期间
// menuitemradio 仍在 DOM，于是 waitFor 照样找得到项、click 却点在正在消失的节点上 →
// 落空 → 抛「目标模式未生效」。已是 Hy4 preview 时 think 只读入口尾缀，不再点任何项。
async function yuanbaoMustNotToggleAnAlreadyOpenMenu() {
  let opens = 0;
  const c = yuanbaoCase({}, { openMenu: () => { opens += 1; } });  // 桩里菜单恒可见 = 已经开着
  await c.adapter.think();
  assert.equal(opens, 0, "菜单已展开时不得再点触发器——那一点会把它关掉");
  assert.deepEqual(c.clicked, [], "模型已是 Hy4 preview：不点入口也不点模型项");
  assert.equal(c.adapter.state(), "think");
}

// 合成点击偶发被吞（真机见过一次展不开）。Claude 的 _open 与 Gemini 的 _openModelMenu 都会重开一次，
// 元宝此前一次不成就抛「目标模式未找到」。
async function yuanbaoMustRetryOpeningTheModeMenu() {
  let opens = 0, visible = false;
  const c = yuanbaoCase({}, { openMenu: () => { opens += 1; if (opens >= 2) visible = true; } });
  const adapter = c.adapter;
  adapter._modeItems = () => (visible ? [{ textContent: "ThinkingDeep reasoning" }] : []);
  let thrown = null;
  try { await adapter._openModes({}); } catch (error) { thrown = error; }

  assert.equal(thrown, null, "第一次没展开必须重开一次，而不是直接抛");
  assert.equal(opens, 2, "恰好重试一次");
}

// 思考（Thinking）不再是预设档：用户手选的合法档位，state 返回 null 而不是猜成 think
async function yuanbaoThinkingModeIsNotAPreset() {
  const c = yuanbaoCase({ mode: "Thinking", model: "Hy3" });
  assert.equal(c.adapter.state(), null);
}

// —— Kimi：escMenus 只收得掉 effort 子菜单，根菜单要回点入口 ——
async function kimiRootMenuMustBeClosedByRetrigger() {
  const clicked = [];
  const state = { active: true };
  const entry = {
    classList: { contains: (name) => name === "active" && state.active },
    click() { clicked.push("entry"); state.active = !state.active; },
    querySelector: (selector) => (selector === ".name" ? { textContent: "K3" }
      : (selector === ".current-effort" ? { textContent: "Max" } : null)),
  };
  const document = {
    querySelector: (selector) => (selector === ".current-model" ? entry : null),
    querySelectorAll: () => [],
  };
  const S = runtime(document);
  await S.adapters["kimi.com"]._close();
  assert.equal(state.active, false, "escMenus 之后菜单还开着时，必须回点入口把根菜单关掉");
  assert.ok(S.escCount >= 1, "回点入口之前仍要先走 escMenus（它能收掉 effort 子菜单）");
  state.active = false; S.escCount = 0; clicked.length = 0;
  await S.adapters["kimi.com"]._close();
  assert.deepEqual(clicked, [], "菜单本就关着时不许再点入口（点了等于重新打开）");
}

let failed = 0;
(async () => {
  const tests = [glmThinkMustPreferTopTier, glmThinkMustFallBackToDeep, glmStateMustAcceptBothThinkTiers,
    glmMenuMustBeClosedByRetrigger, yuanbaoThinkMustPickHy4Preview, yuanbaoFastMustLeaveHy4PreviewFirst,
    yuanbaoMustNotToggleAnAlreadyOpenMenu, yuanbaoMustRetryOpeningTheModeMenu, yuanbaoThinkingModeIsNotAPreset,
    kimiRootMenuMustBeClosedByRetrigger];
  for (const test of tests) {
    try { await test(); }
    catch (error) { failed++; console.error(error.stack || error); }
  }
  if (failed) process.exitCode = 1;
  else console.log("✓ 智谱极致档、元宝 Hy4 preview 档位与模式语义校验、Kimi 根菜单收尾兼容");
})();
