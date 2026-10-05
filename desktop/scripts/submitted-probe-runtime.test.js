"use strict";
// wasSubmitted 只读确认（core.js 监听器 → read-commands.js）：{supported:true, ok:false} 是唯一会触发自动重发的组合，
// 只能由「适配器同步返回 false + 页面在出帧 + 无进行中的视图过渡」产生，其余一律 fail-closed 成不支持。
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = (file) => fs.readFileSync(path.join(__dirname, "../src/site-runtime", file), "utf8");

function runtime(submitted, { paints = true, transition = null } = {}) {
  let listener = null;
  const context = {
    window: {}, location: { hostname: "kimi.com" }, Date, setTimeout, clearTimeout, console,
    document: { activeViewTransition: transition },
    chrome: { runtime: { onMessage: { addListener(fn) { listener = fn; } } } },
    // 停帧的视图：rAF 永不回调（被遮挡后跨文档导航，2026-10-04 真机）
    requestAnimationFrame: paints ? (fn) => setTimeout(fn, 5) : () => 0,
  };
  vm.runInNewContext(source("core.js"), context);
  vm.runInNewContext(source("read-commands.js"), context);
  context.window.__AMS.adapters["kimi.com"] = submitted === undefined ? { state: () => null } : { state: () => null, submitted };
  return (deadline = Date.now() + 300) => new Promise((resolve) => {
    const respond = (value) => resolve(JSON.parse(JSON.stringify(value))); // vm 跨 realm：按值比较
    const async = listener({ source: "AMS", cmd: "wasSubmitted", text: "question", deadline }, {}, respond);
    if (async !== true) setTimeout(() => resolve({ unanswered: true }), 0);
  });
}

const UNSUPPORTED = { supported: false, ok: false };

test("a confirmed negative needs a boolean false from a painting page without a view transition", async () => {
  assert.deepEqual(await runtime(() => false)(), { supported: true, ok: false });
  assert.deepEqual(await runtime(() => true)(), { supported: true, ok: true });
});

test("adapter exceptions and non-boolean results are unsupported, never a confirmed negative", async () => {
  assert.deepEqual(await runtime(() => { throw new Error("dom changed"); })(), UNSUPPORTED);
  for (const value of [undefined, null, 0, "", "no", {}]) {
    assert.deepEqual(await runtime(() => value)(), UNSUPPORTED, `submitted() 返回 ${JSON.stringify(value)} 不是确认`);
  }
  assert.deepEqual(await runtime(undefined)(), UNSUPPORTED, "没有 submitted() 的站");
});

test("a page that is not painting or is stuck in a view transition cannot confirm a negative", async () => {
  assert.deepEqual(await runtime(() => false, { paints: false })(), UNSUPPORTED, "rAF 300ms 内不回调 = 停帧，DOM 不可信");
  assert.deepEqual(await runtime(() => false, { transition: {} })(), UNSUPPORTED, "Kimi 视图过渡挂住时 DOM 不更新");
  assert.deepEqual(await runtime(() => false)(Date.now() + 40), UNSUPPORTED, "预算不足以完成出帧探测即判不支持");
  assert.deepEqual(await runtime(() => true, { paints: false, transition: {} })(), { supported: true, ok: true }, "正向结论不受影响");
});
