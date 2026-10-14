"use strict";

const vm = require("node:vm");
const { source, fakeRuntime } = require("./intl-harness");

function geminiRuntime({ models = ["3.1 Pro", "4 Argon Complex tasksNew", "3.8 Flash"],
  levels = ["Low Quick and efficient", "Medium Balanced depth", "High Extra thorough"],
  thinkingEntry = true, ignoredLevel = false, disabled = [], hidden = [], decoys = [], initialLevel = "Low",
  expandedDecoys = [], detachedLevels = false } = {}) {
  let open = false, expanded = false, model = "3.8 Flash", level = initialLevel;
  const clicked = [];
  const item = (text, type) => ({ textContent: text, type,
    getBoundingClientRect: () => ({ width: hidden.includes(text) ? 0 : 200, height: 40 }),
    classList: { contains: name => name === "selected" && (type === "level"
      ? text.startsWith(level + " ") || text === level : text.startsWith(model)) },
    getAttribute: name => name === "aria-disabled" ? String(disabled.includes(text)) : null,
    focus() {}, dispatchEvent() { return true; } });
  const options = models.map(text => item(text, "model"));
  const tiers = levels.map(text => item(text, "level"));
  const unrelated = decoys.map(text => item(text, "unrelated"));
  const extra = expandedDecoys.map(text => item(text, "unrelated"));
  const trigger = { ...item("Thinking level", "trigger"), id: "thinking-level",
    contains: node => !detachedLevels && tiers.includes(node) };
  for (const tier of tiers) tier.closest = () => ({ getAttribute: name => name === "aria-labelledby" ? trigger.id : null });
  const button = { getAttribute: name => name === "aria-label"
    ? "Open mode picker, currently " + (/Argon/.test(model) ? "Argon " + level : model)
    : name === "aria-expanded" ? String(open) : null };
  const document = {
    querySelector: selector => selector.includes("input-area-swi") ? button : null,
    querySelectorAll: selector => selector === "button" ? [button]
      : selector.includes("mat-mdc-menu-item") && open
        ? [...options, ...(thinkingEntry ? [trigger] : []), ...unrelated, ...(expanded ? [...tiers, ...extra] : [])] : []
  };
  const S = fakeRuntime(document, clicked, node => {
    if (node === trigger) expanded = true;
    else if (node === button) open = true;
  });
  S.clickEl = node => {
    clicked.push(node);
    if (node === button) { open = false; expanded = false; }
    if (node.type === "model") { model = node.textContent.split(/\s+(?:Complex|Advanced|All-around)/)[0]; open = false; }
    if (node.type === "level" && !ignoredLevel) { level = node.textContent.split(" ")[0]; open = false; expanded = false; }
    return true;
  };
  vm.runInNewContext(source("adapters-intl3.js"), { window: { __AMS: S }, document,
    t: key => key, console, KeyboardEvent: class { constructor(type) { this.type = type; } } });
  return { adapter: S.adapters["gemini.google.com"], clicked, options, tiers, unrelated,
    isOpen: () => open, current: () => ({ model, level }) };
}

module.exports = { geminiRuntime };
