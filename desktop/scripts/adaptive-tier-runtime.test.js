"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function runtime(adapter, options = {}) {
  let now = 1000, listener, submissions = 0, owned = !!options.alreadyOwned;
  const composer = { tagName: "DIV", textContent: "", focus() {},
    getBoundingClientRect: () => ({ left: 0, right: 200, top: 0, bottom: 40, width: 200, height: 40 }) };
  class Event { constructor(type, init) { this.type = type; Object.assign(this, init); } }
  const context = vm.createContext({ window: {}, location: { hostname: "test.invalid" },
    document: { body: { dispatchEvent() {} }, dispatchEvent() {}, querySelectorAll: sel => sel.includes("textarea") ? [composer] : [] },
    chrome: { runtime: { onMessage: { addListener(fn) { listener = fn; } } } },
    innerWidth: 1000, innerHeight: 1000, t: key => key, console: { debug() {} },
    KeyboardEvent: Event, MouseEvent: Event, CustomEvent: Event,
    Date: { now: () => now }, setTimeout(fn, ms) { now += ms; queueMicrotask(fn); },
  });
  for (const file of ["core.js", "tier.js"]) {
    const target = path.join(__dirname, "../src/site-runtime", file);
    if (fs.existsSync(target)) vm.runInContext(fs.readFileSync(target, "utf8"), context);
  }
  const S = context.window.__AMS;
  S.adapters["test.invalid"] = {
    inject(el, text) { el.textContent = text; return true; },
    submit() { submissions++; if (options.newMessage) owned = true; if (!options.keepComposer) composer.textContent = ""; return true; },
    ...adapter,
  };
  S.history = { begin() {}, submitted: token => token === "current" && owned };
  return { S, now: () => now, submissions: () => submissions,
    dispatch: (extra = {}) => new Promise(resolve => listener({ source: "AMS", cmd: "submitPrompt", text: "fixture",
      historyToken: "current", deadline: 20000, images: [], tier: "think", ...extra }, {}, resolve)) };
}

test("无异常但状态不可读不能报告切档成功，也不能重复点击猜结果", async () => {
  let actions = 0;
  const r = runtime({ think: async () => { actions++; }, state: () => null });
  assert.equal(await r.S.runMode("think", true, 10000), false);
  assert.equal(actions, 1);
});

test("状态未知仍发送一次，返回未确认选择而非假绿", async () => {
  let actions = 0;
  const r = runtime({ think: async () => { actions++; }, state: () => null });
  const result = await r.dispatch();
  assert.equal(result.ok, true);
  assert.equal(result.code, "tier_unconfirmed");
  assert.equal(result.selection.outcome, "unconfirmed");
  assert.equal(actions, 1);
  assert.equal(r.submissions(), 1);
  assert.ok(r.now() < 10000, "不能耗完切档预算才发现没有证据");
});

test("旧站只证明模式，不凭 state 声称精确模型", async () => {
  const r = runtime({ think: async () => {}, state: () => "think" });
  const result = await r.dispatch();
  assert.equal(result.selection.outcome, "mode_only");
  assert.equal(result.selection.observed, "think");
  assert.equal(result.selection.model, undefined);
  assert.equal(result.code, undefined);
});

test("本次动作的模式证据在菜单收起后可确认，但不留给下一次调用", async () => {
  let calls = 0;
  const r = runtime({ think: async () => ++calls === 1 ? { outcome: "mode_only", observed: "think" } : undefined,
    state: () => null });
  const first = await r.dispatch();
  assert.equal(first.selection.outcome, "mode_only");
  assert.equal(first.code, undefined);
  const second = await r.dispatch();
  assert.equal(second.selection.outcome, "unconfirmed");
  assert.equal(second.code, "tier_unconfirmed");
  assert.equal(r.submissions(), 2, "每次独立请求只提交一次");
});

test("动作证据也须校验形状、目标模式与收尾后的相反状态", async () => {
  for (const receipt of [null, true, false, [], "think", { outcome: "mode_only", observed: "fast" },
    { outcome: "mode_only", observed: "think", model: "unexpected" },
    { outcome: "preferred", observed: "think", model: "unsafe\u202emodel" }]) {
    const r = runtime({ think: async () => receipt, state: () => "think" });
    assert.equal((await r.dispatch()).selection.outcome, "unconfirmed", JSON.stringify(receipt));
  }
  const changed = runtime({ think: async () => ({ outcome: "mode_only", observed: "think" }), state: () => "fast" });
  assert.equal((await changed.dispatch()).selection.outcome, "unconfirmed");
});

test("切档收尾失败或已过截止时间时不能采用动作证据", async () => {
  let r;
  r = runtime({ think: async deadline => {
    await r.S.sleep(20000, deadline);
    return { outcome: "mode_only", observed: "think" };
  }, state: () => null });
  assert.equal((await r.dispatch({ deadline: 1400 })).selection.outcome, "unconfirmed");
  const failed = runtime({ think: async () => {
    try { return { outcome: "mode_only", observed: "think" }; }
    finally { throw Error("cleanup failed"); }
  }, state: () => "think" });
  assert.equal((await failed.dispatch()).selection.outcome, "unconfirmed");
});

test("试点当前页面的精确选择证据可透传", async () => {
  const r = runtime({ think: async () => {}, state: () => "think",
    selection: () => ({ outcome: "preferred", observed: "think", model: "Fixture Model" }) });
  const result = await r.dispatch();
  assert.equal(result.selection.model, "Fixture Model");
  assert.equal(result.selection.outcome, "preferred");
});

test("声明精确模型但观测模式错误时必须未确认", async () => {
  const r = runtime({ think: async () => {}, state: () => "think",
    selection: () => ({ outcome: "preferred", observed: "fast", model: "Fixture Model" }) });
  const result = await r.dispatch();
  assert.equal(result.selection.outcome, "unconfirmed");
  assert.equal(result.code, "tier_unconfirmed");
  assert.equal(r.submissions(), 1);
});

test("运行时拒绝与跨进程契约不一致的畸形证据", async () => {
  for (const value of [
    { outcome: "mode_only", observed: "think", model: null },
    { outcome: "preferred", observed: "think", model: "Fixture\u202eModel" },
  ]) {
    const r = runtime({ think: async () => {}, selection: () => value });
    const result = await r.dispatch();
    assert.equal(result.selection.outcome, "unconfirmed");
    assert.equal(result.code, "tier_unconfirmed");
  }
});

test("切档抛错不能因原状态相同误报成功，仍保留发送", async () => {
  let calls = 0;
  const r = runtime({ think: async () => { calls++; throw Error("unsafe action"); }, state: () => "think" });
  const result = await r.dispatch();
  assert.equal(result.selection.outcome, "unconfirmed");
  assert.equal(calls, 2);
  assert.equal(r.submissions(), 1);
});

test("提交后只读确认本轮消息，输入框未清空也可报告正向证据", async () => {
  const r = runtime({}, { newMessage: true, keepComposer: true });
  const result = await r.dispatch({ tier: null });
  assert.equal(result.ok, true);
  assert.equal(result.submissionEvidence, "message");
  assert.equal(r.submissions(), 1);
});

test("输入框变化保留兼容但标明弱证据", async () => {
  const r = runtime({});
  const result = await r.dispatch({ tier: null });
  assert.equal(result.ok, true);
  assert.equal(result.submissionEvidence, "composer");
});

test("站点等到发送键可用后提交，确认窗口从动作返回起算", async () => {
  let r, calls = 0;
  r = runtime({ submit: async el => { calls++; await r.S.sleep(3500); el.textContent = ""; return true; } });
  const result = await r.dispatch({ tier: null });
  assert.equal(result.ok, true);
  assert.equal(result.submissionEvidence, "composer");
  assert.equal(calls, 1);
});

test("旧 owned 不能冒充本轮消息；不确定提交绝不再次点击", async () => {
  const r = runtime({}, { alreadyOwned: true, keepComposer: true });
  const result = await r.dispatch({ tier: null });
  assert.equal(result.ok, false);
  assert.equal(result.code, "submit_unconfirmed");
  assert.equal(result.submissionEvidence, undefined);
  assert.equal(r.submissions(), 1);
});

test("错误历史 token 不能确认本轮消息", async () => {
  const r = runtime({}, { newMessage: true, keepComposer: true });
  const result = await r.dispatch({ tier: null, historyToken: "other" });
  assert.equal(result.ok, false);
  assert.equal(r.submissions(), 1);
});

test("切档已确认但提交未确认时保留两种事实", async () => {
  const r = runtime({ think: async () => {}, state: () => "think" }, { keepComposer: true });
  const result = await r.dispatch();
  assert.equal(result.ok, false);
  assert.equal(result.code, "submit_unconfirmed");
  assert.equal(result.selection.outcome, "mode_only");
});

test("切档预算耗尽时不注入或提交，仍保留切档未确认结果", async () => {
  let r;
  r = runtime({ think: async deadline => { await r.S.sleep(20000, deadline); }, state: () => "think" });
  const result = await r.dispatch({ deadline: 1400 });
  assert.equal(result.ok, false);
  assert.equal(result.code, "timeout");
  assert.equal(result.selection.outcome, "unconfirmed");
  assert.equal(r.submissions(), 0);
});
