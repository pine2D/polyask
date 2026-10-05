#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");
const vm = require("node:vm");

const source = () => fs.readFileSync(require("node:path").join(__dirname, "../src/site-runtime/generation.js"), "utf8");
const rect = (top = 500) => ({ width: 40, height: 40, top, bottom: top + 40, left: 600, right: 640 });

// Each control carries the selector fragments it answers to, so a stop button
// that the site never labels stays invisible to the probe — the stub must not
// hand back matches the real selector list would miss.
function matchesSelector(control, selector) {
  const fragments = selector.split(",").map((part) => part.trim()).filter(Boolean);
  return fragments.some((fragment) => (control.selectors || []).includes(fragment));
}

function run(host, adapter, controls = []) {
  const composer = { getBoundingClientRect: () => rect(600) };
  const document = {
    querySelectorAll: (selector) => controls.filter((control) => matchesSelector(control, selector)),
  };
  const context = {
    document,
    innerHeight: 900,
    innerWidth: 1200,
    location: { hostname: host },
    window: {
      __AMS: {
        adapters: { [host]: adapter },
        findComposer: () => composer,
      },
    },
  };
  vm.runInNewContext(source(), context);
  return adapter;
}

test("generation probe reports only a visible nearby stop control as generating", () => {
  const visible = {
    selectors: ['[data-testid="stop-button"]'],
    getBoundingClientRect: () => rect(540),
  };
  const hidden = {
    selectors: ['[data-testid="stop-button"]'],
    getBoundingClientRect: () => ({ ...rect(540), width: 0, height: 0 }),
  };
  assert.equal(run("claude.ai", { answer: () => ({}) }, [visible]).generation(), "generating");
  assert.equal(run("claude.ai", { answer: () => ({}) }, [hidden]).generation(), "complete");

  // Claude 的停止键 testid 是 chat-input-stop（同族 chat-input / chat-input-send / chat-input-attach
  // 均已真机核实）；stop-button 是 ChatGPT 的形状，Claude 上零命中。只剩 aria-label 兜底时，
  // 界面一切成非英文就会把「生成中」误判成已完成。
  const selectors = require("node:fs").readFileSync(
    require("node:path").join(__dirname, "../src/site-runtime/generation.js"), "utf8");
  const claudeLine = selectors.split("\n").find((line) => line.includes('"claude.ai":'));
  assert.ok(claudeLine && claudeLine.includes('[data-testid="chat-input-stop"]'),
    "claude.ai 的停止键选择子必须含 chat-input-stop");
});

test("a stop control the selector list cannot name stays unseen", () => {
  const unlabelled = {
    selectors: [".ds-button--primary"],
    getBoundingClientRect: () => rect(540),
  };
  assert.equal(run("deepseek.com", { answer: () => ({}) }, [unlabelled]).generation(), "complete");
  const labelled = {
    selectors: ['[aria-label*="stop" i]'],
    getBoundingClientRect: () => rect(540),
  };
  assert.equal(run("deepseek.com", { answer: () => ({}) }, [labelled]).generation(), "generating");
});

test("generation probe reports completion from the existing read-only answer hook", () => {
  assert.equal(run("gemini.google.com", { answer: () => ({}) }).generation(), "complete");
  assert.equal(run("gemini.google.com", { answer: () => null }).generation(), "idle");
});

test("unknown sites and adapter failures stay unsupported", () => {
  assert.equal(run("example.com", { answer: () => ({}) }).generation, undefined);
  assert.equal(run("chatgpt.com", { answer: () => { throw new Error("changed"); } }).generation(), null);
});

test("generation wrapper is idempotent", () => {
  const adapter = run("kimi.com", { answer: () => null });
  const first = adapter.generation;
  const context = {
    document: { querySelectorAll: () => [] },
    innerHeight: 900,
    innerWidth: 1200,
    location: { hostname: "kimi.com" },
    window: { __AMS: { adapters: { "kimi.com": adapter }, findComposer: () => null } },
  };
  vm.runInNewContext(source(), context);
  assert.equal(adapter.generation, first);
});

test('ChatGLM searching control keeps thought-only turns generating', () => {
  const stop = { selectors: ['.enter.searching'], getBoundingClientRect: () => rect(620) };
  assert.equal(run('chatglm.cn', { answer: () => null }, [stop]).generation(), 'generating');
  assert.equal(run('chatglm.cn', { answer: () => null }).generation(), 'idle');
});

for (const [host, selector] of [
  ['chatgpt.com', 'button[aria-label="Stop"]'],
  ['kimi.com', '.send-button-container.stop'],
  ['doubao.com', '[class*="break-btn-"]'],
  ['yuanbao.tencent.com', '#yuanbao-send-btn[aria-label="Stop Answering"]'],
  ['yuanbao.tencent.com', '#yuanbao-send-btn[aria-label="停止回答"]'],
  ['yuanbao.tencent.com', '#yuanbao-send-btn[class*="sendStop"]'],
  ['deepseek.com', '.ds-button--primary:has(svg path[d^="M2 4.88C2"])'],
]) {
  test(`${host} recognizes the verified September stop control, including thought-only replies`, () => {
    const stop = { selectors: [selector], getBoundingClientRect: () => rect(620) };
    assert.equal(run(host, { answer: () => null }, [stop]).generation(), 'generating');
    stop.getBoundingClientRect = () => ({ ...rect(620), width: 0 });
    assert.equal(run(host, { answer: () => null }, [stop]).generation(), 'idle');
  });
}

// 停止键锁存（C10，2026-10-04 真机）：短回答的停止键整段落在两次 900ms 探测之间，主进程从没见过 generating，
// 只能超时报 generation_unconfirmed。提交时武装的观察器亲眼见过停止键出现，探测读到 complete 时改报 complete_observed。
function latchRun(host = "chatgpt.com") {
  let now = 0, observer = null, stopShown = false;
  const timers = [];
  const stop = { selectors: ['button[aria-label="Stop"]'], getBoundingClientRect: () => (stopShown ? rect(540) : { ...rect(540), width: 0 }) };
  const adapter = { answer: () => ({}) };
  const context = {
    document: { documentElement: {}, querySelectorAll: (selector) => [stop].filter((control) => matchesSelector(control, selector)) },
    innerHeight: 900, innerWidth: 1200, location: { hostname: host },
    Date: { now: () => now },
    setTimeout: (fn, ms) => { timers.push({ fn, at: now + ms }); return timers.length; }, clearTimeout: (id) => { if (timers[id - 1]) timers[id - 1].fn = null; },
    MutationObserver: class { constructor(fn) { this.fn = fn; observer = this; } observe() { this.on = true; } disconnect() { this.on = false; } },
    window: { __AMS: { adapters: { [host]: adapter }, findComposer: () => ({ getBoundingClientRect: () => rect(600) }) } },
  };
  vm.runInNewContext(source(), context);
  const S = context.window.__AMS;
  const flush = () => { for (const t of timers) if (t.fn && t.at <= now) { const fn = t.fn; t.fn = null; fn(); } };
  return { S, adapter, show: (v) => { stopShown = v; }, advance: (ms) => { now += ms; flush(); },
    mutate: () => { if (observer?.on) observer.fn([]); }, observer: () => observer };
}

test("a stop control seen between probes after submission latches positive completion evidence", () => {
  const r = latchRun();
  assert.equal(r.S.generationProbe(), "complete", "没武装：照旧 complete");
  r.S.armGeneration();
  r.advance(150); r.show(true); r.mutate();
  r.advance(600); r.show(false); r.mutate();
  assert.equal(r.observer().on, false, "锁存后观察器即断开");
  assert.equal(r.S.generationProbe(), "complete_observed");
  r.S.armGeneration();
  assert.equal(r.S.generationProbe(), "complete", "每次提交重新武装，旧锁存不跨提交");
  r.show(true);
  assert.equal(r.S.generationProbe(), "generating", "停止键在时照旧报 generating");
  r.adapter.answer = () => null; r.show(false);
  assert.equal(r.S.generationProbe(), "idle", "没有回答时锁存不把 idle 改成完成");
});

test("a stop control already showing at arm time only counts after it has been seen gone", () => {
  const r = latchRun();
  r.show(true); r.S.armGeneration();
  r.advance(200); r.mutate();
  r.show(false);
  assert.equal(r.S.generationProbe(), "complete", "提交前就在的停止键不是本次生成的证据");
  r.advance(200); r.show(true); r.mutate(); r.show(false);
  assert.equal(r.S.generationProbe(), "complete_observed");
});

test("observer sampling is throttled with a trailing check, and quiet pages never latch", () => {
  const r = latchRun();
  r.S.armGeneration();
  r.advance(200); r.mutate();
  r.advance(10); r.show(true); r.mutate();
  r.show(false); r.advance(200);
  assert.equal(r.S.generationProbe(), "complete", "节流期内一闪而过、尾采样时已消失：不臆测");
  r.mutate();
  r.advance(10); r.show(true); r.mutate(); r.mutate();
  assert.equal(r.observer().on, true, "节流窗口内不采样");
  r.advance(100); r.show(false);
  assert.equal(r.S.generationProbe(), "complete_observed", "节流窗口内的变更由尾采样补上");
  const quiet = latchRun();
  quiet.S.armGeneration(); quiet.advance(5_000); quiet.mutate();
  assert.equal(quiet.S.generationProbe(), "complete", "从没见过停止键：不以文本静止推断完成");
});

test("a stop flash without a new answer node never upgrades: the previous turn's answer is not this run's completion", () => {
  const r = latchRun();
  const previous = { isConnected: true };
  r.adapter.answer = () => previous;
  r.S.armGeneration();
  r.advance(150); r.show(true); r.mutate();
  r.advance(300); r.show(false); r.mutate();
  assert.equal(r.S.generationProbe(), "complete", "请求失败、answer() 仍是武装前那个节点：原样 complete，交回主进程的 observedGenerating 规则");
  const fresh = { isConnected: true };
  r.adapter.answer = () => fresh;
  assert.equal(r.S.generationProbe(), "complete_observed", "本轮出了新的已连接回答节点才升级");
  fresh.isConnected = false;
  assert.equal(r.S.generationProbe(), "complete", "已脱离文档的节点不算");
  const first = latchRun();
  let node = null;
  first.adapter.answer = () => node;
  first.S.armGeneration();
  first.advance(150); first.show(true); first.mutate();
  first.advance(300); first.show(false); node = { isConnected: true };
  assert.equal(first.S.generationProbe(), "complete_observed", "首轮基线为 null，出现回答即新鲜");
});

// D1（2026-10-04 Windows 真机 zh-CN）：ChatGPT 中文界面的停止键是 button[aria-label="停止"]、没有 testid，选择子漏了它，
// 每次中文群发都报 generation_unconfirmed。用真实选择子在 jsdom 里核对：精确「停止」算停止键，「停止朗读」不算。
test("ChatGPT Chinese UI: the exact 停止 label is the stop control, look-alike labels are not", () => {
  const { JSDOM } = require("jsdom");
  const dom = new JSDOM('<!doctype html><body><button id="stop" aria-label="停止"></button><button id="tts" aria-label="停止朗读"></button></body>',
    { url: "https://chatgpt.com/c/abc", runScripts: "outside-only" });
  const { window } = dom;
  try {
    for (const button of window.document.querySelectorAll("button")) button.getBoundingClientRect = () => rect(540);
    const adapter = { answer: () => null };
    window.__AMS = { adapters: { "chatgpt.com": adapter }, findComposer: () => ({ getBoundingClientRect: () => rect(600) }) };
    vm.runInContext(source(), dom.getInternalVMContext());
    assert.equal(adapter.generation(), "generating");
    window.document.getElementById("stop").remove();
    assert.equal(adapter.generation(), "idle", "「停止朗读」等同前缀控件不是停止键");
  } finally { window.close(); }
});
