"use strict";
// intl-runtime.test.js 与 claude-effort-runtime.test.js 共用的离线夹具。
const fs = require("node:fs");
const path = require("node:path");

const source = (file) => fs.readFileSync(path.join(__dirname, "../../src/site-runtime", file), "utf8");

// helper 语义贴近生产：findByText 走真实选择器、openMenu/clickEl 记录副作用。
// escMenus 必须是计数器而非空桩——「每个菜单动作自己收尾」是硬约束，空桩让违反者永远绿。
// waitFor 也必须消耗 timeout：忽略它就分不清 waitFor(fn, 1500) 与无超时调用，短超时用例形同虚设。
function fakeRuntime(document, clicked, onOpen) {
  const findByText = (selector, re, root) =>
    [...(root || document).querySelectorAll(selector)].find((n) => re.test((n.textContent || "").trim())) || null;
  const runtime = {
    ...require("./deadline-harness"), adapters: {}, findByText, sleep: async () => {}, escCount: 0, escMenus() { runtime.escCount++; },
    waitFor: async (fn, timeout = 3500, step = 120) => { // 与生产 core.js 同构：轮询到超时才返回 null
      for (let waited = 0; ; waited += step) { const v = fn(); if (v) return v; if (waited >= timeout) return null; }
    },
    openMenu: (el) => onOpen(el),
    clickEl: (el) => { clicked.push(el); return true; },
  };
  return runtime;
}

module.exports = { source, fakeRuntime };
