#!/usr/bin/env node
"use strict";
// adapters-cn2.js（Kimi）与 adapters-cn3.js（元宝）的发送 / 附件 / 只读确认语义回归。
// 从 site-send-runtime.test.js 拆出（那份撞 300 行）；档位语义在 cn-tier-runtime.test.js，两边不重叠。
const assert = require("node:assert/strict");
const test = require("node:test");
const vm = require("node:vm");
const { source, helpers } = require("./lib/site-send-harness");

test("Kimi 走工具菜单取 file input 时收尾 escMenus 且等待夹取 deadline，并能确认最后一条用户消息", async () => {
  let input = null, attached = null, escCount = 0, waited = null;
  const toolkit = { click() { input = { className: "hidden-input" }; } };
  const oldUser = { querySelector: () => ({ textContent: "旧问题" }) };
  const lastUser = { querySelector: () => ({ textContent: "  新问题\n第二行  " }) };
  const document = {
    querySelector(selector) {
      if (selector === ".toolkit-trigger-btn") return toolkit;
      if (selector === 'input.hidden-input[type="file"]') return input;
      return null;
    },
    querySelectorAll(selector) { return selector === ".chat-content-item-user" ? [oldUser, lastUser] : []; },
  };
  const context = helpers(document, {
    waitFor: async (fn, ms) => { waited = ms; return fn(); },
    escMenus() { escCount++; },
    setInputFiles(found, files, el, deadline) { attached = { found, files, el, deadline }; return Promise.resolve(true); },
    dropFiles() { return Promise.resolve(false); },
  });
  vm.runInNewContext(source("adapters-cn2.js"), context);
  const kimi = context.window.__AMS.adapters["kimi.com"], files = [{ name: "probe.png" }], composer = {};
  const deadline = Date.now() + 900; // < 1500，等待必须被夹到剩余预算
  assert.equal(await kimi.attach(files, composer, deadline), true);
  assert.equal(attached.found === input, true);
  assert.equal(escCount, 1, "走 toolkit 分支必须收尾 escMenus，否则罩住输入框");
  assert.ok(waited > 0 && waited <= 900, "等待必须夹取到 deadline 剩余预算，不是硬编码 1500");
  assert.equal(kimi.submitted("新问题 第二行"), true);
  assert.equal(kimi.submitted("别的问题"), false);
});

test("Kimi 模型名与菜单项文案含零宽字符时，判档和真实 _select 比对都不失效", async () => {
  const zwsp = String.fromCharCode(0x200b); // 避免在源码里字面写 ​ 转义序列
  let clickedItem = false;
  const entry = { classList: { contains: () => false }, click() {},
    querySelector: (s) => (s === ".name" ? { textContent: "K3" + zwsp } : s === ".current-effort" ? { textContent: "Max" } : null) };
  const modelItem = { querySelector: (s) => (s === ".name" ? { textContent: "K3" + zwsp } : null), click() { clickedItem = true; } };
  const document = { querySelector: (s) => (s === ".current-model" ? entry : null),
    querySelectorAll: (s) => (s === ".model-item" ? [modelItem] : []) };
  const context = helpers(document);
  vm.runInNewContext(source("adapters-cn2.js"), context);
  const kimi = context.window.__AMS.adapters["kimi.com"];
  assert.equal(kimi.state(), "think", "模型名带零宽字符不该让判档失效");
  await kimi._select("K3"); // 真实调用，不 stub：菜单项 .name 也带零宽字符
  assert.equal(clickedItem, true, "菜单项文案带零宽字符时精确等值比对仍要命中并点击");
});

test("元宝 think 切到 Hy4 preview（站点自动落专家），并使用语义发送键", async () => {
  let selected = "Instant", model = "Hy3", menuOpen = false, sent = false;
  const trigger = {
    textContent: selected,
    click() { menuOpen = true; },
    getAttribute(name) { return name === "aria-label" ? "Switch model" : null; },
  };
  const modeMenu = { getAttribute: () => null }, modelMenu = { getAttribute: (n) => (n === "aria-label" ? "Model list" : null) };
  const item = (text) => ({
    textContent: text, closest: () => modeMenu,
    getAttribute(name) { return name === "aria-checked" ? String(selected === text) : null; },
    click() { selected = text; trigger.textContent = text; menuOpen = false; },
  });
  // 模型项：选中 Hy4 preview 后站点只剩专家模式，按钮回显 Expert
  const modelItem = (text) => ({ textContent: text, closest: () => modelMenu, getAttribute: () => null,
    click() { model = text; if (/^Hy4/.test(text)) { selected = "Expert"; trigger.textContent = "Expert"; } } });
  let modelsOpen = false;
  const entry = { click() {}, dispatchEvent(ev) { if (ev.type === "mousemove") modelsOpen = true; } };
  Object.defineProperty(entry, "textContent", { get: () => "Models" + model });
  const modes = [item("Instant"), item("Thinking"), item("Expert")], models = [modelItem("Hy4 preview"), modelItem("Hy3")];
  const send = { className: "SendButton_sendButton", getAttribute: () => null, click() { sent = true; } };
  const document = {
    querySelector(selector) {
      if (selector === 'button[aria-label="Switch model"], button[aria-label="切换模型"]') return trigger;
      if (selector === '[aria-label="Send"], [aria-label="发送"]') return send;
      return null;
    },
    querySelectorAll(selector) {
      if (selector === '[role="menuitemradio"]') return menuOpen ? modes.concat(modelsOpen ? models : []) : [];
      return selector === '[role="menuitem"]' && menuOpen ? [entry] : [];
    },
  };
  const context = helpers(document, { openMenu: (el) => el.click(), dropFiles: () => Promise.resolve(true) });
  vm.runInNewContext(source("adapters-cn3.js"), context);
  const yuanbao = context.window.__AMS.adapters["yuanbao.tencent.com"];
  assert.equal(yuanbao.state(), "fast");
  await yuanbao.think();
  assert.equal(yuanbao.state(), "think");
  yuanbao.submit();
  assert.equal(sent, true);
});

// 切档链路（core.js 的 runModeNow / switchTier）：把 escMenus 的 Escape、toast 文案与适配器调用记在同一条
// 序列上，就能断言「谁在谁之后发生」。composer 只为让 submitPrompt 消息入口走完全程。

// Kimi 注入（真机 2026-10-10）：execCommand 吞换行 → 合成 paste；单次 ~1.5k 字起转 TXT 附件 → 1000 单元同步分块。
function kimiInject({ handled = () => true } = {}) {
  const pastes = [], commands = [];
  const range = { selectNodeContents() {} };
  const document = { querySelector: () => null, querySelectorAll: () => [], createRange: () => range,
    execCommand(command, _ui, value) { commands.push([command, value]); return true; } };
  const context = helpers(document);
  Object.assign(context, {
    getSelection: () => ({ removeAllRanges() {}, addRange() {} }),
    DataTransfer: class { setData(type, value) { this[type] = value; } },
    ClipboardEvent: class { constructor(type, init) { Object.assign(this, { type, ...init, defaultPrevented: false }); } },
  });
  vm.runInNewContext(source("adapters-cn2.js"), context);
  const el = { focus() {}, dispatchEvent(event) {
    if (event.type !== "paste") return;
    pastes.push(event.clipboardData["text/plain"]);
    event.defaultPrevented = handled(pastes.length);
  } };
  return { inject: (text) => context.window.__AMS.adapters["kimi.com"].inject(el, text), pastes, commands };
}

test("Kimi 多行经合成 paste 注入，长文本按 ≤1000 单元同步分块且不切断代理对", () => {
  const r = kimiInject();
  r.inject("第一行\n\n    缩进");
  assert.deepEqual(r.pastes, ["第一行\n\n    缩进"]);
  assert.deepEqual(r.commands, [], "粘贴被接管就不再 execCommand，否则会重复写入");
  const long = "a".repeat(999) + "😀" + "b".repeat(1500);
  const chunked = kimiInject();
  chunked.inject(long);
  assert.equal(chunked.pastes.join(""), long);
  assert.ok(chunked.pastes.every((part) => part.length <= 1000 && !/^[\uDC00-\uDFFF]/.test(part)));
});

test("Kimi 编辑器不接管 paste 时退回 execCommand；分块中途不接管则抛出交给 inject_failed", () => {
  const fallback = kimiInject({ handled: () => false });
  fallback.inject("单行问题");
  assert.deepEqual(fallback.commands, [["insertText", "单行问题"]]);
  const midway = kimiInject({ handled: (n) => n === 1 });
  assert.throws(() => midway.inject("x".repeat(2500)), /分块粘贴中途/);
});
