"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");

// 2026-11-03 用户两次脱敏 DOM：simple/models 双面板常驻，隐藏 pane 仍有矩形尺寸。
// React 的模型点击/重绘由小型状态机代替；适配器、core 与 tier 均加载生产源码。
const PRESETS = ["GPT-6 Luna High", "GPT-6.1 Sol Light", "GPT-6.1 Sol Medium",
  "GPT-6 Astra Light", "GPT-6 Astra Medium", "GPT-6 Astra Extra High"];
function defaultCase(options = {}) {
  const dom = new JSDOM('<body><textarea>existing draft</textarea></body>', { url: "https://chatgpt.com/", runScripts: "outside-only" });
  const w = dom.window, d = w.document;
  const state = { open: false, view: options.view || "simple", index: options.index ?? 3,
    selected: options.selected || "Default", clicks: [], keys: [], clock: 1000 };
  w.console = console; w.t = key => key;
  w.innerHeight = 900; w.innerWidth = 1000;
  w.Element.prototype.getBoundingClientRect = function () {
    return { width: this.hidden ? 0 : 280, height: 32, top: 10, left: 10, bottom: 42, right: 290 };
  };
  const RealDate = w.Date;
  w.Date = class extends RealDate { static now() { return state.clock; } };
  const trigger = d.createElement("button");
  trigger.id = "trigger"; trigger.setAttribute("aria-haspopup", "menu");
  trigger.setAttribute("data-composer-navigation-target", "reasoning");
  trigger.setAttribute("data-selected-reasoning-effort", "medium");
  d.body.append(trigger);
  const labels = options.labels || ["Default", "GPT-6.1 Sol", "GPT-6.1 Terra", "GPT-6 Astra", "GPT-6 Sol", "GPT-6 Luna", "GPT-5.6 Sol"];
  function render() {
    d.getElementById("picker")?.remove();
    trigger.setAttribute("aria-expanded", String(state.open));
    trigger.setAttribute("data-state", state.open ? "open" : "closed");
    const legacyLabel = state.selected + " " + (state.index === 0 ? "Instant" : state.index === 4 ? "Pro" : "High");
    trigger.textContent = state.open ? "Select model" : options.label || (options.legacy ? legacyLabel : PRESETS[state.index]) || "Unknown";
    if (!state.open) { trigger.removeAttribute("aria-controls"); return; }
    trigger.setAttribute("aria-controls", "picker");
    const root = d.createElement("div"); root.id = "picker";
    root.setAttribute("role", "menu"); root.setAttribute("aria-labelledby", options.wrongOwner ? "other" : "trigger");
    root.innerHTML = `<div data-model-picker-view="${state.view}">
      <div data-pane="simple" data-active="${state.view === "simple"}" aria-hidden="${state.view !== "simple"}">
        <div role="menuitem" aria-label="Select model" data-model-picker-view-toggle="true" tabindex="0">Select model</div>
        <span id="level">${state.index === 1 ? "Light" : state.index === 5 ? "Extra High" : "Medium"}, ${state.index + 1} of 6.</span>
        <div role="menuitem" aria-label="Power" data-reasoning-slider="true" aria-describedby="level" aria-keyshortcuts="ArrowLeft ArrowRight" tabindex="0" ${state.view !== "simple" || options.disabledPower ? 'aria-disabled="true" data-disabled=""' : ""}>
          <div data-model-picker-power-slider=""><span role="slider" aria-hidden="true" tabindex="-1" aria-valuemin="0" aria-valuemax="${options.max ?? 5}" aria-valuenow="${state.index}"></span></div>
        </div>
      </div>
      <div data-pane="models" data-active="${state.view === "models"}" aria-hidden="${state.view !== "models"}">
        ${labels.map(label => `<div role="menuitemradio" aria-checked="${label === state.selected}" ${label === "Default" && options.disabledDefault ? 'aria-disabled="true"' : ""}><span>${label}</span>${label === "Default" ? "<span>Recommended set of models</span>" : ""}</div>`).join("")}
      </div></div>`;
    d.body.append(root);
    root.querySelector('[data-model-picker-view-toggle]').addEventListener("click", () => {
      state.clicks.push("models"); if (state.view !== "simple") throw new Error("inactive view toggle");
      state.view = "models"; render();
    });
    for (const item of root.querySelectorAll('[role="menuitemradio"]')) item.addEventListener("click", () => {
      if (state.view !== "models") throw new Error("inactive model clicked");
      const label = item.querySelector("span").textContent; state.clicks.push(label);
      if (options.swallowModel) return;
      state.selected = label; state.view = "simple"; state.open = false; render();
    });
    root.querySelector('[aria-label="Power"]').addEventListener("keydown", event => {
      if (state.view !== "simple" || options.disabledPower) throw new Error("inactive Power used");
      state.keys.push(event.key);
      if (!options.swallowKeys) state.index = Math.max(0, Math.min(options.max ?? 5,
        state.index + (event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0)));
      render();
    });
  }
  trigger.addEventListener("click", () => { state.open = !state.open; render(); });
  d.body.addEventListener("keydown", event => { if (event.key === "Escape") { state.open = false; render(); } });
  render();
  const load = file => w.eval(fs.readFileSync(path.join(__dirname, "../../src/site-runtime", file), "utf8"));
  load("core.js");
  const S = w.__AMS;
  S.sleep = async (ms, deadline) => {
    S.checkDeadline(deadline);
    state.clock += deadline ? Math.min(ms, Math.max(0, deadline - state.clock)) : ms;
    S.checkDeadline(deadline);
  };
  S.waitFor = async (fn, timeout = 3500, step = 120, deadline) => {
    for (let elapsed = 0; elapsed <= timeout; elapsed += step) {
      S.checkDeadline(deadline); const value = fn(); if (value) return value;
      state.clock += step;
    }
    return null;
  };
  for (const file of ["selection-match.js", "adapters-intl2.js", "chatgpt-default.js", "tier.js"]) {
    if (fs.existsSync(path.join(__dirname, "../../src/site-runtime", file))) load(file);
  }
  // core 的闭包等待仍保持真实实现；入口与页面事件边界使用上述可控时钟。
  return { dom, w, S, state, adapter: S.adapters["chatgpt.com"],
    render, close: () => dom.window.close() };
}
module.exports = { defaultCase };
