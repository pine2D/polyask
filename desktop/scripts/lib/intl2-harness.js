"use strict";
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = (file) => fs.readFileSync(path.join(__dirname, "../../src/site-runtime", file), "utf8");

// 真机 2026-08-31 的档名与位次（0..4）。0–3 档的档名只出现在 describedby 的朗读文本里，
// 不在任何可选中的节点上——这正是「不许拿标签判档、只认 X of N」的由来。
const TIERS = ["Instant", "Medium", "High", "Extra High", "Pro"];

function chatGptCase(options) {
  const opts = options || {};
  const clicked = [], keys = [];
  const min = opts.min ?? 0, max = opts.max ?? 4;
  const state = { open: false, value: opts.value == null ? 2 : opts.value };
  const attr = (map) => ({ getAttribute: (name) => (name in map ? map[name] : null) });

  const desc = { id: "_r_desc_", get textContent() { return opts.description ?? (TIERS[state.value] + ", " + (state.value - min + 1) + " of " + (max - min + 1) + "."); } };
  const slider = Object.assign({ tagName: "SPAN" }, {
    getAttribute: (name) => name === "aria-valuenow" ? (opts.missingNow ? null : String(state.value))
      : name === "aria-valuemin" ? String(min) : name === "aria-valuemax" ? String(max) : name === "role" ? "slider" : null,
  });
  const power = {
    closest: selector => selector === '[role="menu"]' ? root : null,
    getBoundingClientRect: () => ({ width: opts.hiddenPower ? 0 : 200, height: 32 }),
    getAttribute: (name) => name === "aria-label" ? "Power" : name === "aria-describedby" ? "_r_desc_" : null,
    querySelector: (selector) => selector === '[role="slider"]' ? (opts.dropSlider ? null : slider)
      : selector === "[data-model-reasoning-effort-slider]" ? {} : null,
    focus() {},
    dispatchEvent(event) {
      if (event.type !== "keydown") return true;
      keys.push(event.key);
      if (event.key === "ArrowRight") state.value = Math.min(max, state.value + 1); // 端点饱和，不越界
      if (event.key === "ArrowLeft") state.value = Math.max(min, state.value - 1);
      return true; // End / Home 真机无效：这里同样刻意不实现，写了就红
    },
  };
  const radio = (spec) => ({ textContent: spec.text,
    getBoundingClientRect: () => ({ width: spec.hidden ? 0 : 100, height: 32 }),
    getAttribute: name => name === "aria-checked" ? String(spec.checked === true)
      : name === "aria-disabled" && spec.disabled ? "true" : null,
    click() { clicked.push(spec.text); if (!opts.swallowed) {
      for (const entry of specs) entry.checked = entry === spec;
      state.open = false;
    } },
  });
  const specs = opts.models || [{ text: "GPT-6", checked: true }, { text: "GPT-5.6 Sol" }];
  const models = specs.map(radio);
  const selectModel = Object.assign({ textContent: "Pro", querySelector: () => null,
    click() { clicked.push("select-model"); } }, attr({ "aria-label": "Select model" }));
  // 菜单开着时 pill 显示控件名而不是档名——旧 _anchor 的文本前置校验就是栽在这里
  const pill = { className: "__composer-pill",
    get innerText() { return state.open ? (opts.openLabel || "Thinking effort") : (opts.pill || TIERS[state.value]); },
    get textContent() { return (opts.measurement || "") + this.innerText; },
    set textContent(value) { opts.pill = value; },
    getAttribute: (name) => name === "aria-haspopup" ? "menu"
      : name === "aria-expanded" ? String(state.open) : null };

  const menuItems = opts.dropPower ? [selectModel] : [selectModel, power];
  const root = { querySelectorAll: selector => selector === '[role="menuitemradio"]' && state.open ? models : [] };
  const outsider = radio({ text: "GPT-5.6 Sol", checked: true });
  const document = {
    getElementById: (id) => (id === "_r_desc_" ? desc : null),
    querySelector: (selector) => {
      if (selector === 'button[data-codex-intelligence-trigger="true"][aria-haspopup="menu"]') return opts.modern && !opts.missing ? pill : null;
      if (selector === 'button.__composer-pill[aria-haspopup="menu"]') return !opts.modern && !opts.missing ? pill : null;
      if (selector.includes("composer-intelligence-picker-content")) return state.open && !opts.modern ? root : null;
      return null;
    },
    querySelectorAll: (selector) => {
      if (selector === '[role="menuitem"]') return state.open ? menuItems : [];
      if (selector === '[role="menuitemradio"]') return state.open ? [...models, ...(opts.outsideModel ? [outsider] : [])] : [];
      return [];
    },
  };
  const S = fakeRuntime(document, clicked, () => { state.open = true; }, () => { state.open = false; });
  class FakeKeyboardEvent { constructor(type, init) { this.type = type; Object.assign(this, init); } }
  const context = { window: { __AMS: S }, t: (key) => key, document, console, KeyboardEvent: FakeKeyboardEvent };
  for (const file of ["selection-match.js", "adapters-intl2.js"]) vm.runInNewContext(source(file), context);
  return { adapter: S.adapters["chatgpt.com"], S, clicked, keys, state, models, pill };
}

// escMenus 必须是计数器而非空桩——「每个菜单动作自己收尾」是硬约束，空桩让违反者永远绿。
function fakeRuntime(document, clicked, onOpen, onClose) {
  const findByText = (selector, re, root) =>
    [...(root || document).querySelectorAll(selector)].find((n) => re.test((n.textContent || "").trim())) || null;
  const runtime = {
    ...require("./deadline-harness"), adapters: {}, findByText, sleep: async () => {}, escCount: 0,
    escMenus() { runtime.escCount++; document.__closed = true; onClose?.(); },
    waitFor: async (fn, timeout = 3500, step = 120) => {
      for (let waited = 0; ; waited += step) { const v = fn(); if (v) return v; if (waited >= timeout) return null; }
    },
    openMenu: (el) => onOpen(el),
    clickEl: (el) => { clicked.push(el); return true; },
  };
  return runtime;
}

module.exports = { chatGptCase, source };
