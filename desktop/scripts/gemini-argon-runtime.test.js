#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const vm = require("node:vm");
const { source } = require("./lib/intl-harness");
const { geminiRuntime } = require("./lib/gemini-harness");

async function argonTakesPriorityOverProAndUsesHigh() {
  const c = geminiRuntime();
  await c.adapter.think();
  assert.equal(c.current().model, "4 Argon", "新版深档必须优先 Argon，不能继续选旧 Pro");
  assert.equal(c.current().level, "High", "Argon 使用实际最高等级 High");
  assert.equal(c.adapter.state(), "think", "Argon 必须可读为粗思考档");
  assert.equal(c.clicked.includes(c.options[0]), false, "Argon 在场时不选 Pro");
  assert.equal(c.isOpen(), false, "模型与等级菜单均须收尾");
}

async function argonHighAndLowAreIdempotent() {
  const c = geminiRuntime({ models: ["3.5 Flash-Lite", "4 Argon Complex tasksNew", "3.8 Flash"] });
  await c.adapter.think();
  const first = c.clicked.filter(node => node.type === "level").length;
  await c.adapter.think();
  assert.equal(c.current().level, "High");
  assert.equal(c.clicked.filter(node => node.type === "level").length, first, "重复思考不再点击已选中 High");
  await c.adapter.fast();
  assert.equal(c.current().model, "4 Argon", "快档也必须使用 Argon，不能换回 Flash");
  assert.equal(c.current().level, "Low", "同一 Argon 模型按快档切回 Low");
  assert.equal(c.adapter.state(), "fast");
  const lowClicks = c.clicked.filter(node => node.type === "level").length;
  await c.adapter.fast();
  assert.equal(c.clicked.filter(node => node.type === "level").length, lowClicks, "重复快速不再点击已选中 Low");
  assert.equal(c.clicked.includes(c.options[0]), false, "不能误选 Flash-Lite");
  assert.equal(c.isOpen(), false);
}

async function absentOrHiddenArgonKeepsLegacyModes() {
  for (const config of [
    { models: ["3.1 Pro", "3.8 Flash"], thinkingEntry: false },
    { hidden: ["4 Argon Complex tasksNew"], thinkingEntry: false },
    { models: ["4.1 Argon", "4 Argon-Lite", "3.2 Pro", "3.8 Flash"], thinkingEntry: false }
  ]) {
    const c = geminiRuntime(config);
    await c.adapter.think();
    assert.match(c.current().model, /Pro$/, "缺少确切 Argon 4 时保留版本无关 Pro");
    await c.adapter.fast();
    assert.equal(c.current().model, "3.8 Flash", "旧菜单快速保留非 Lite Flash");
    assert.equal(c.isOpen(), false);
  }
}

async function modernProFallbackAlsoUsesHigh() {
  const c = geminiRuntime({ models: ["3.1 Pro", "3.8 Flash"] });
  await c.adapter.think();
  assert.equal(c.current().model, "3.1 Pro");
  assert.equal(c.current().level, "High", "无 Argon 的新版等级布局仍须设置 Pro 的 High");
  assert.equal(c.isOpen(), false);
}

async function disabledOrAmbiguousArgonCannotSilentlyFallBack() {
  for (const config of [
    { disabled: ["4 Argon Complex tasksNew"] },
    { models: ["4 Argon Complex tasks", "4 Argon Other entry", "3.1 Pro"] }
  ]) {
    for (const mode of ["think", "fast"]) {
      const c = geminiRuntime(config);
      await assert.rejects(() => c.adapter[mode](), "Argon 在场但不可用/歧义时应报错");
      assert.equal(c.clicked.some(node => node.type === "model"), false, "不猜测模型，不退到 Pro/Flash");
      assert.equal(c.isOpen(), false, "失败也须关闭菜单");
    }
  }
}

async function argonMissingOrDisabledHighFails() {
  for (const config of [
    { thinkingEntry: false },
    { levels: ["Low Quick and efficient", "Medium Balanced depth"] },
    { disabled: ["High Extra thorough"] },
    { ignoredLevel: true }
  ]) {
    const c = geminiRuntime(config);
    await assert.rejects(() => c.adapter.think(), "缺 High 或点击未生效时不能谎报成功");
    assert.equal(c.isOpen(), false);
  }
}

async function unrelatedHighCannotBeSelectedAsThinkingLevel() {
  const c = geminiRuntime({ levels: ["Low Quick and efficient"], decoys: ["High Preview"] });
  await assert.rejects(() => c.adapter.think(), "必须从 Thinking level 子菜单取等级");
  assert.equal(c.clicked.includes(c.unrelated[0]), false, "同 role 的其它 High 项不能当思考等级");
  assert.equal(c.isOpen(), false);
}

async function deadlineExpiryDoesNotStartModelSelection() {
  const c = geminiRuntime();
  await assert.rejects(() => c.adapter.think(Date.now() - 1), /timeout/);
  assert.equal(c.clicked.length, 0, "截止时间已过不点击模型或等级");
}

async function argonLowMustBeAvailableAndApplied() {
  for (const config of [{ thinkingEntry: false }, { levels: ["High Extra thorough"] },
    { disabled: ["Low Quick and efficient"] }, { ignoredLevel: true, initialLevel: "High" }]) {
    const c = geminiRuntime(config);
    await assert.rejects(() => c.adapter.fast(), "新版快档 Low 缺失/不可用/点击未生效须报错");
    assert.equal(c.isOpen(), false);
  }
}

async function legacyNestedExtendedAllowsFastWithoutLow() {
  for (const detachedLevels of [false, true]) {
    const c = geminiRuntime({ models: ["3.1 Pro", "3.8 Flash"], detachedLevels,
      levels: ["Standard Normal depth", "Extended Longer reasoning"] });
    await c.adapter.think();
    assert.equal(c.current().level, "Extended");
    await c.adapter.fast();
    assert.equal(c.current().model, "3.8 Flash", "旧嵌套 Extended 菜单没有 Low，快档仍合法完成");
    assert.equal(c.isOpen(), false);
  }
}

async function argonLowConfirmationSurvivesOmittedLabelWithoutCaching() {
  const c = geminiRuntime({ omitLowLabel: true });
  c.S.pickAdapter = () => c.adapter;
  c.S.runModeAction = async (mode, _silent, _image, deadline) => ({ selection: await c.adapter[mode](deadline) });
  vm.runInNewContext(source("tier.js"), { window: { __AMS: c.S } });
  for (const mode of ["think", "fast", "fast", "think"]) {
    const result = await c.S.resolveTier(mode, Date.now() + 10_000);
    assert.equal(result.outcome, "mode_only", "本次已复读等级，应能通过生产 tier 证据校验");
    assert.equal(result.observed, mode);
    assert.equal(c.current().model, "4 Argon");
    assert.equal(c.current().level, mode === "fast" ? "Low" : "High");
    const clicks = c.clicked.length;
    assert.equal(c.adapter.state(), mode === "fast" ? null : "think", "闭合标签缺等级时不猜、不开菜单");
    assert.equal(c.clicked.length, clicks);
  }
  c.adapter._setThinking = async () => { throw Error("level unavailable"); };
  await assert.rejects(() => c.S.resolveTier("fast", Date.now() + 10_000), /level unavailable/,
    "上一次确认不能掩盖本次动作失败");
}

async function argonModelMustActuallyApplyBeforeLow() {
  const c = geminiRuntime({ ignoredModel: true });
  await assert.rejects(() => c.adapter.fast(), /Argon/, "Flash 已是快速也不能冒充 Argon Low");
  assert.equal(c.current().model, "3.8 Flash");
  assert.equal(c.isOpen(), false);
}

async function unrelatedExtendedCannotHideMissingModernLow() {
  for (const config of [{ expandedDecoys: ["Extended preview"] }, { decoys: ["Extended preview"] }]) {
    const c = geminiRuntime({ ...config, levels: [], initialLevel: "High" });
    await assert.rejects(() => c.adapter.fast(), "等级菜单外的 Extended 不能冒充旧布局，跳过 Low");
    assert.equal(c.isOpen(), false);
  }
}

(async () => {
  let failed = 0;
  for (const test of [argonTakesPriorityOverProAndUsesHigh, argonHighAndLowAreIdempotent,
    absentOrHiddenArgonKeepsLegacyModes, modernProFallbackAlsoUsesHigh, disabledOrAmbiguousArgonCannotSilentlyFallBack,
    argonMissingOrDisabledHighFails, unrelatedHighCannotBeSelectedAsThinkingLevel,
    deadlineExpiryDoesNotStartModelSelection, argonLowMustBeAvailableAndApplied,
    legacyNestedExtendedAllowsFastWithoutLow, unrelatedExtendedCannotHideMissingModernLow,
    argonLowConfirmationSurvivesOmittedLabelWithoutCaching, argonModelMustActuallyApplyBeforeLow]) {
    try { await test(); }
    catch (error) { failed++; console.error(test.name + ": " + error.message); }
  }
  if (failed) process.exitCode = 1;
  else console.log("✓ Gemini Argon High/Low、旧版回退与本次确认边界（13 组）");
})();
