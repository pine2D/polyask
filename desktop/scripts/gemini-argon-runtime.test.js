#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
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

async function argonHighIsIdempotentAndFastStillUsesFlash() {
  const c = geminiRuntime({ models: ["3.5 Flash-Lite", "4 Argon Complex tasksNew", "3.8 Flash"] });
  await c.adapter.think();
  const first = c.clicked.filter(node => node.type === "level").length;
  await c.adapter.think();
  assert.equal(c.current().level, "High");
  assert.equal(c.clicked.filter(node => node.type === "level").length, first, "重复思考不再点击已选中 High");
  await c.adapter.fast();
  assert.equal(c.current().model, "3.8 Flash");
  assert.equal(c.current().level, "Low", "新版跨模型记忆等级，快档须重置到 Low");
  assert.equal(c.adapter.state(), "fast");
  assert.equal(c.clicked.includes(c.options[0]), false, "不能误选 Flash-Lite");
  assert.equal(c.isOpen(), false);
}

async function absentOrHiddenArgonKeepsLegacyPro() {
  for (const config of [
    { models: ["3.1 Pro", "3.8 Flash"], thinkingEntry: false },
    { hidden: ["4 Argon Complex tasksNew"], thinkingEntry: false },
    { models: ["4.1 Argon", "4 Argon-Lite", "3.2 Pro", "3.8 Flash"], thinkingEntry: false }
  ]) {
    const c = geminiRuntime(config);
    await c.adapter.think();
    assert.match(c.current().model, /Pro$/, "缺少确切 Argon 4 时保留版本无关 Pro");
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

async function disabledOrAmbiguousArgonCannotSilentlySelectPro() {
  for (const config of [
    { disabled: ["4 Argon Complex tasksNew"] },
    { models: ["4 Argon Complex tasks", "4 Argon Other entry", "3.1 Pro"] }
  ]) {
    const c = geminiRuntime(config);
    await assert.rejects(() => c.adapter.think(), "Argon 在场但不可用/歧义时应报错");
    assert.equal(c.clicked.some(node => node.type === "model"), false, "不猜测模型，不偷偷退到 Pro");
    assert.equal(c.isOpen(), false, "失败也须关闭菜单");
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

async function modernFlashLowMustBeAvailableAndApplied() {
  for (const config of [{ levels: ["High Extra thorough"] },
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

async function unrelatedExtendedCannotHideMissingModernLow() {
  for (const config of [{ expandedDecoys: ["Extended preview"] }, { decoys: ["Extended preview"] }]) {
    const c = geminiRuntime({ ...config, levels: [], initialLevel: "High" });
    await assert.rejects(() => c.adapter.fast(), "等级菜单外的 Extended 不能冒充旧布局，跳过 Low");
    assert.equal(c.isOpen(), false);
  }
}

(async () => {
  let failed = 0;
  for (const test of [argonTakesPriorityOverProAndUsesHigh, argonHighIsIdempotentAndFastStillUsesFlash,
    absentOrHiddenArgonKeepsLegacyPro, modernProFallbackAlsoUsesHigh, disabledOrAmbiguousArgonCannotSilentlySelectPro,
    argonMissingOrDisabledHighFails, unrelatedHighCannotBeSelectedAsThinkingLevel,
    deadlineExpiryDoesNotStartModelSelection, modernFlashLowMustBeAvailableAndApplied,
    legacyNestedExtendedAllowsFastWithoutLow, unrelatedExtendedCannotHideMissingModernLow]) {
    try { await test(); }
    catch (error) { failed++; console.error(test.name + ": " + error.message); }
  }
  if (failed) process.exitCode = 1;
  else console.log("✓ Gemini Argon 优先/High/Flash Low/旧 Pro/不可用与子菜单边界（11 组）");
})();
