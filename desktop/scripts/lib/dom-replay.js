"use strict";
// desktop/scripts/lib/dom-replay.js — 把脱敏 DOM fixture 装进 jsdom，按 preload 真实 require 顺序跑生产
// site-runtime classic scripts（与 webpack 一样逐文件包一层函数），返回 window.__AMS 供离线对拍。
// 注入清单取自 desktop-anchors 的 preloadRequires()：site.ts 新登记的卷（如 history-locate.js）自动纳入，
// 不在这里另维护一份顺序。jsdom 的差异只补两处：innerText（退化为 textContent）与 computed display 兜底；
// 没有布局（getBoundingClientRect 恒 0），依赖几何的判定（停止键可见性等）不在回放范围内。
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { JSDOM } = require("jsdom");
const { ROOT, preloadRequires } = require("./desktop-anchors");
const { FIXTURE_DIR } = require("./dom-fixture-scan");

function listFixtures(dir = FIXTURE_DIR) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((file) => file.endsWith(".json")).map((file) => file.slice(0, -5)).sort();
}

function loadFixture(name, dir = FIXTURE_DIR) {
  const html = fs.readFileSync(path.join(dir, `${name}.html`), "utf8");
  const meta = JSON.parse(fs.readFileSync(path.join(dir, `${name}.json`), "utf8"));
  return { name, html, meta };
}

function polyfill(window) {
  const proto = window.HTMLElement.prototype;
  if (!Object.getOwnPropertyDescriptor(proto, "innerText")) {
    Object.defineProperty(proto, "innerText", { configurable: true,
      get() { return this.textContent; }, set(value) { this.textContent = value; } });
  }
  const computed = window.getComputedStyle.bind(window);
  window.getComputedStyle = (el, pseudo) => {
    const style = computed(el, pseudo);
    if (style.display) return style;
    return new Proxy(style, { get: (target, key) => key === "display" ? "inline" : Reflect.get(target, key) });
  };
  // Navigation API（jsdom 未实现）只补 currentEntry.key 的槽位语义：pushState 换槽、replaceState 留槽，与 Chromium 一致。
  // history-route.js 据此区分豆包 local_ → 正式 id 的 replace 与侧栏打开别的会话的 push；traverse 不建模。
  if (!("navigation" in window)) {
    let slots = 0;
    const navigation = { currentEntry: { key: "slot-0" } };
    const push = window.history.pushState.bind(window.history);
    window.history.pushState = (...args) => { push(...args); navigation.currentEntry = { key: `slot-${++slots}` }; };
    Object.defineProperty(window, "navigation", { configurable: true, value: navigation });
  }
  if (typeof window.matchMedia !== "function") window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
}

// fixture 的 html 是对话区子树：放进 <body>，location 设为采集时记录的 host + 脱敏 path。
// files 可覆盖注入清单（仓库相对路径）；默认整条 preload 链。lang 走 i18n.setLang，与 preload 一致。
function replayHtml(html, { host, path: pathname = "/", files, lang = "en" } = {}) {
  if (!host) throw new Error("replay_host_missing");
  const dom = new JSDOM(`<!doctype html><html><head></head><body>${html}</body></html>`,
    { url: `https://${host}${pathname}`, runScripts: "outside-only", pretendToBeVisual: true });
  const { window } = dom;
  polyfill(window);
  const listeners = [];
  // core.js 的消息入口：收集监听器，send() 按 preload 的分发方式调用（同步回包或 Promise）。
  window.chrome = { runtime: { onMessage: { addListener: (fn) => listeners.push(fn) } } };
  const context = dom.getInternalVMContext();
  for (const file of files || preloadRequires()) {
    const source = fs.readFileSync(path.join(ROOT, file), "utf8");
    vm.runInContext(`(function () {\n${source}\n})()`, context, { filename: file });
  }
  window.__AMS_I18N__?.setLang?.(lang);
  const S = window.__AMS;
  const adapter = Object.entries(S?.adapters || {}).find(([key]) => host === key || host.endsWith(`.${key}`))?.[1] || null;
  const send = (msg) => new Promise((resolve) => {
    let async = false;
    for (const fn of listeners) if (fn(msg, {}, resolve) === true) async = true;
    if (!async) setTimeout(() => resolve(undefined), 0);
  });
  // history.begin 会挂 16 分钟定时器与 MutationObserver：测试结束务必 close()，否则 node --test 不退出。
  const close = () => window.close();
  return { dom, window, document: window.document, S, adapter, send, close };
}

function replayFixture(fixture, options = {}) {
  const value = typeof fixture === "string" ? loadFixture(fixture) : fixture;
  return { ...replayHtml(value.html, { host: value.meta.host, path: value.meta.path, ...options }), meta: value.meta };
}

module.exports = { FIXTURE_DIR, listFixtures, loadFixture, replayHtml, replayFixture };
