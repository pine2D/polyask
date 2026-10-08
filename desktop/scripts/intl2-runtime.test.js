#!/usr/bin/env node
"use strict";

// site-runtime/adapters-intl2.js（ChatGPT）的离线回归。2026-08-31 改版把档位从「Effort 子菜单里的
// menuitemradio 列表」换成「Power 项上的一根 5 格滑块」，键盘驱动；这里把出事那天的 DOM 做成假对象。
const assert = require("node:assert/strict");
const vm = require("node:vm");

const { chatGptCase, source } = require("./lib/intl2-harness");

// think 走滑块最右端、fast 走最左端；两端都不许点到模型 radio
async function sliderMustBeDrivenToBothEdges() {
  for (const [top, goal, key] of [[true, 4, "ArrowRight"], [false, 0, "ArrowLeft"]]) {
    const c = chatGptCase({ value: 2 });
    await c.adapter._pickEdge(top);
    assert.equal(c.state.value, goal, "档位必须推到端点：" + key);
    assert.ok(c.keys.every((k) => k === key), "只能用左右方向键：End/Home 真机无效（实测值纹丝不动）");
    assert.ok(!c.clicked.some((x) => c.models.includes(x)), "切档绝不能点到模型 radio：" + key);
    assert.ok(c.S.escCount >= 1, "选档后必须 escMenus 收尾（菜单会罩住输入框）：" + key);
  }
}

// 已在端点时一次键都不该按（有状态控件先读后点）
async function sliderMustBeIdempotentAtEdge() {
  const c = chatGptCase({ value: 4 });
  await c.adapter._pickEdge(true);
  assert.equal(c.keys.length, 0, "已是最高档不该再按方向键");
  assert.ok(c.S.escCount >= 1, "幂等路径同样要收尾");
}

// 滑块整个不见了必须抛错，不许静默成功（runMode 会据此弹假成功 toast）
async function missingSliderMustThrow() {
  const c = chatGptCase({ dropPower: true });
  await assert.rejects(async () => c.adapter._pickEdge(true));
  assert.equal(c.keys.length, 0, "找不到滑块时不得乱按键");
}

// 菜单开着时 pill 文本是控件名「Thinking effort」：这是非终态，state() 必须返回 null 而不是猜档
function openMenuPillMustNotBeReadAsTier() {
  const c = chatGptCase({ value: 4 });
  assert.equal(c.adapter.state(), "think", "菜单关着时 pill=Pro → think");
  c.state.open = true;
  assert.equal(c.adapter.state(), null, "菜单开着时 pill=Thinking effort，不是档位，只能判 null");
  assert.equal(c.adapter.diagnose()[0].ok, true, "入口按钮还在，入口项不该跟着变红");
}

// _anchor 是纯选择子：档位标签集漂移（出现我们不认识的档名）只该让「已识别档位」红，入口项保持绿
function entryCheckMustSurviveLabelDrift() {
  const c = chatGptCase({ value: 4 });
  c.pill.textContent = "Ludicrous";
  const checks = c.adapter.diagnose();
  assert.equal(checks[0].ok, true, "按钮还在，Intelligence 入口项不该跟着标签集一起红");
  assert.equal(checks[1].ok, false, "档位读不出必须由「已识别档位」这一项单独报出");
}

// 模型已是目标就不点（点了会连带把菜单收掉，随后的 _pickEdge 得重开）；不是目标才点
async function modelSelectionMustBeIdempotent() {
  const same = chatGptCase({});
  await same.adapter.think();
  assert.deepEqual(same.clicked, [], "已是 GPT-6 时不该点任何东西");
  const other = chatGptCase({ models: [{ text: "GPT-5.6 Sol" }, { text: "GPT-5.5", checked: true }] });
  await other.adapter.think();
  assert.ok(other.clicked.includes("GPT-5.6 Sol"), "模型不对时必须点中维护的目标 radio");
}

// 2026-09-28：新版入口去掉样式类，隐藏测量文字仍在 textContent 中。
async function modernTriggerMustSwitchBothTiers() {
  const c = chatGptCase({ modern: true, measurement: "Thinking effort" });
  assert.equal(c.adapter.diagnose()[0].ok, true, "新版语义入口必须可达");
  await c.adapter.think();
  assert.equal(c.state.value, 4);
  await c.adapter.fast();
  assert.equal(c.state.value, 0);
}

function modernStateMustIgnoreMeasurementAndOpenMenu() {
  for (const [pill, expected] of [["GPT-6 Pro", "think"], ["GPT-6 Instant", "fast"], ["GPT-6.1 Sol Pro", null], ["最新 - 中", "fast"], ["5.6 Sol Pro", "think"], ["5.5Pro", null], ["未知", null]]) {
    const c = chatGptCase({ modern: true, pill, measurement: "Medium", openLabel: "Pro" });
    assert.equal(c.adapter.state(), expected, "只读可见档位，隐藏测量文字不得参与判定：" + pill);
    assert.equal(c.clicked.length, 0, "读状态不得操作菜单");
    c.state.open = true;
    assert.equal(c.adapter.state(), null, "菜单展开但标签尚未重绘时，也不能把旧 Pro 标签识别为当前档位");
  }
}

async function missingTriggerMustRemainFailure() {
  const c = chatGptCase({ modern: true, missing: true });
  assert.equal(c.adapter.diagnose()[0].ok, false);
  assert.equal(c.adapter.state(), null);
  await assert.rejects(() => c.adapter.think(), /Intelligence/);
  assert.equal(c.keys.length, 0);
}

function newTurnMustBeCollected() {
  const markdown = { marker: "answer" };
  const turns = [{ querySelector: () => null }, { querySelector: (s) => s === ".markdown" ? markdown : null }];
  const S = { ...require("./lib/deadline-harness"), adapters: {}, waitFor: async (fn) => fn(), findByText: () => null,
    openMenu() {}, clickEl() {}, sleep: async () => {}, escMenus() {} };
  const context = { window: { __AMS: S }, t: (key) => key, console,
    document: { querySelector: () => null,
      querySelectorAll: (s) => s === '[data-turn="assistant"]' ? turns : [] } };
  vm.runInNewContext(source("adapters-intl2.js"), context);
  assert.equal((S.adapters["chatgpt.com"].answer()) === (markdown), true, "ChatGPT 新版 data-turn 回答必须可被汇总复制");
}

const selection = (adapter, mode) => {
  assert.equal(typeof adapter.selection, "function", "需要当前页面的只读切档证据");
  return JSON.parse(JSON.stringify(adapter.selection(mode)));
};

async function modelMatchMustRejectUnsafeCandidates() {
  for (const models of [
    [{ text: "GPT-5.6 Sol", disabled: true }], [{ text: "GPT-5.6 Sol", hidden: true }],
    [{ text: "GPT-5.6 Sol" }, { text: "GPT-5.6 Sol" }],
    [{ text: "GPT-6 Astra" }], [{ text: "GPT-5.6 Sol Max" }], [],
  ]) {
    const c = chatGptCase({ models });
    await assert.rejects(() => c.adapter.think(), /未找到模型/);
    assert.ok(!c.clicked.some(item => item !== "select-model"), "不得点击歧义、禁用或陌生模型");
    assert.equal(c.state.open, false);
  }
}

async function modelClickMustBeReRead() {
  const c = chatGptCase({ swallowed: true,
    models: [{ text: "GPT-5.6 Sol" }, { text: "GPT-5.5", checked: true }] });
  await assert.rejects(() => c.adapter.think(), /模型未生效/);
  assert.equal(c.keys.length, 0, "模型未确认时不继续设置档位");
  assert.equal(c.state.open, false);
  const alias = chatGptCase({ models: [{ text: "GPT–5.6\u200b Sol" }] });
  await alias.adapter.fast();
  assert.equal(alias.state.value, 0);
}

function preciseSelectionNeedsCurrentModelAndEndpoint() {
  const c = chatGptCase({ value: 4 });
  assert.deepEqual(selection(c.adapter, "think"), { outcome: "mode_only", observed: "think" });
  c.state.open = true;
  assert.deepEqual(selection(c.adapter, "think"), { outcome: "preferred", observed: "think", model: "GPT-6" });
  c.state.value = 2;
  assert.equal(selection(c.adapter, "think").outcome, "unconfirmed", "中间强度不能冒充精确端点");
  c.state.value = 0;
  assert.deepEqual(selection(c.adapter, "fast"), { outcome: "preferred", observed: "fast", model: "GPT-6" });
  c.state.open = false;
  assert.deepEqual(selection(c.adapter, "fast"), { outcome: "mode_only", observed: "fast" }, "关菜单后不得缓存刚读到的模型");
  assert.equal(c.clicked.length, 0);
  assert.equal(c.keys.length, 0);
}

function modelWithoutSelectedProofIsNotPreferred() {
  for (const models of [[{ text: "GPT-5.6 Sol" }], [{ text: "GPT-6 Astra", checked: true }],
    [{ text: "GPT-5.6 Sol", checked: true }, { text: "GPT-5.6 Sol", checked: true }]]) {
    const c = chatGptCase({ value: 4, models }); c.state.open = true;
    assert.deepEqual(selection(c.adapter, "think"), { outcome: "mode_only", observed: "think" });
  }
}

function hiddenOrIncompleteSliderCannotProveEndpoint() {
  for (const opts of [{ hiddenPower: true }, { missingNow: true, description: "" },
    { dropSlider: true, description: "1 of 1" }, { dropSlider: true, description: "0 of 5" }]) {
    const c = chatGptCase({ value: 0, ...opts }); c.state.open = true;
    assert.equal(selection(c.adapter, "fast").outcome, "unconfirmed", JSON.stringify(opts));
    assert.equal(selection(c.adapter, "think").outcome, "unconfirmed", JSON.stringify(opts));
  }
}

async function unrelatedModelRadioCannotSupplyAMissingModel() {
  const c = chatGptCase({ modern: true, outsideModel: true, models: [{ text: "GPT-6 Astra", checked: true }] });
  await assert.rejects(() => c.adapter.think(), /未找到模型/);
  assert.ok(!c.clicked.includes("GPT-5.6 Sol"));
}

async function gpt6MustWinAndLegacyMustRemainAnAlternative() {
  for (const [models, model, outcome, clickedLabel = model] of [
    [[{ text: "GPT-6" }], "GPT-6", "preferred"],
    [[{ text: "6" }, { text: "GPT-5.6 Sol", checked: true }], "GPT-6", "preferred", "6"],
    [[{ text: "GPT-5.6 Sol", checked: true }, { text: "GPT-6" }], "GPT-6", "preferred"],
    [[{ text: "GPT-5.6 Sol" }], "GPT-5.6 Sol", "alternative"],
    [[{ text: "GPT-6", disabled: true }, { text: "GPT-5.6 Sol" }], "GPT-5.6 Sol", "alternative"],
  ]) {
    const c = chatGptCase({ models });
    await c.adapter.think();
    assert.equal(c.clicked.includes(clickedLabel), true);
    assert.equal(c.state.value, 4);
    c.state.open = true;
    assert.deepEqual(selection(c.adapter, "think"), { outcome, observed: "think", model });
  }
  for (const models of [[{ text: "GPT-6" }, { text: "GPT-6" }, { text: "GPT-5.6 Sol" }],
    [{ text: "GPT-6" }, { text: "6" }], [{ text: "6.1" }], [{ text: "6 Astra" }],
    [{ text: "GPT-6.1 Sol" }], [{ text: "GPT-7" }]]) {
    await assert.rejects(() => chatGptCase({ models }).adapter.think(), /未找到模型/);
  }
}

async function availableSliderRangeMustDefineBothEdges() {
  for (const [min, max] of [[0, 3], [1, 5]]) {
    const c = chatGptCase({ min, max });
    await c.adapter.think(); assert.equal(c.state.value, max);
    await c.adapter.fast(); assert.equal(c.state.value, min);
    c.state.open = true;
    assert.deepEqual(selection(c.adapter, "fast"), { outcome: "preferred", observed: "fast", model: "GPT-6" });
  }
}

let failed = 0;
(async () => {
  const tests = [gpt6MustWinAndLegacyMustRemainAnAlternative, availableSliderRangeMustDefineBothEdges, sliderMustBeDrivenToBothEdges, sliderMustBeIdempotentAtEdge, missingSliderMustThrow,
    openMenuPillMustNotBeReadAsTier, entryCheckMustSurviveLabelDrift, modelSelectionMustBeIdempotent,
    newTurnMustBeCollected, modernTriggerMustSwitchBothTiers,
    modernStateMustIgnoreMeasurementAndOpenMenu, missingTriggerMustRemainFailure,
    modelMatchMustRejectUnsafeCandidates, modelClickMustBeReRead,
    preciseSelectionNeedsCurrentModelAndEndpoint, modelWithoutSelectedProofIsNotPreferred,
    hiddenOrIncompleteSliderCannotProveEndpoint, unrelatedModelRadioCannotSupplyAMissingModel];
  for (const test of tests) {
    try { await test(); }
    catch (error) { failed++; console.error(error.stack || error); }
  }
  if (failed) process.exitCode = 1;
  else console.log("✓ ChatGPT 滑块档位与常驻模型 radio 兼容");
})();
