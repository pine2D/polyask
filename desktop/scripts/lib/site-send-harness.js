"use strict";
// site-send-runtime.test.js 与 cn2-send-runtime.test.js 共用的离线夹具：读一卷 site-runtime 源码，
// 给它一个最小的 __AMS 桩（helpers 可被 extra 覆盖——覆盖必须在 vm 执行之前，适配器 IIFE 会把引用解构走）。
const fs = require("node:fs");
const path = require("node:path");

const source = (file) => fs.readFileSync(path.join(__dirname, "../../src/site-runtime", file), "utf8");
function helpers(document, extra = {}) {
  const sleep = () => Promise.resolve();
  const waitFor = async (fn) => fn() || null;
  const findByText = (selector, re) => [...document.querySelectorAll(selector)]
    .find((node) => re.test((node.textContent || "").trim())) || null;
  const S = { waitFor, findByText, openMenu() {}, clickEl(el) { el.click(); }, sleep, escMenus() {}, ...require("./deadline-harness"), adapters: {}, ...extra };
  return { document, t: (key) => key, window: { __AMS: S }, MouseEvent: class { constructor(type) { this.type = type; } }, console };
}

module.exports = { source, helpers };
