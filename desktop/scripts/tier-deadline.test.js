"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

function runtime(host, document) {
  let now = 1000, listener;
  const events = [];
  class Event { constructor(type, init) { this.type = type; Object.assign(this, init); } }
  const context = vm.createContext({
    window: {}, document: { body: { dispatchEvent: e => events.push(e.type) },
      querySelectorAll: () => [], querySelector: () => null, dispatchEvent() {}, ...document },
    location: { hostname: host }, innerHeight: 1000, innerWidth: 1000,
    chrome: { runtime: { onMessage: { addListener: fn => { listener = fn; } } } },
    t: key => key, console: { debug() {} }, MouseEvent: Event, KeyboardEvent: Event, CustomEvent: Event,
    Date: { now: () => now }, setTimeout: (fn, ms) => { now += ms; fn(); },
  });
  for (const file of ["core.js", "adapters-intl.js", "adapters-intl2.js", "adapters-cn.js", "adapters-cn2.js", "adapters-cn3.js"])
    vm.runInContext(fs.readFileSync(path.join(__dirname, "../src/site-runtime", file), "utf8"), context);
  return { S: context.window.__AMS, now: () => now, events, dispatch: msg => new Promise(resolve => listener({ source: "AMS", ...msg }, {}, resolve)) };
}

test("expired runMode never calls an adapter or focuses the composer", async () => {
  const r = runtime("example.com"); let calls = 0;
  r.S.adapters["example.com"] = { think: async () => { calls++; } };
  assert.equal(await r.S.runMode("think", true, 999), false);
  assert.equal(calls, 0);
});

test("slow Kimi menu stops at deadline without later option clicks", async () => {
  const clicks = [];
  const entry = { classList: { contains: () => false }, click: () => clicks.push("entry"),
    querySelector: selector => ({ textContent: selector === ".name" ? "K3" : "Standard" }) };
  const r = runtime("kimi.com", { querySelector: () => entry, querySelectorAll: () => [] });
  assert.equal(await r.S.runMode("think", true, 1400), false);
  assert.equal(r.now(), 1400);
  assert.deepEqual(clicks, ["entry"]);
  assert.ok(r.events.includes("keydown"), "menus are dismissed on timeout");
});

test("deadline is absolute and unchanged when passed to an adapter", async () => {
  const r = runtime("example.com"); let deadline;
  r.S.adapters["example.com"] = { think: async value => { deadline = value; } };
  assert.equal(await r.S.runMode("think", true, 2000), true);
  assert.equal(deadline, 2000);
});

test("all nine adapters reject expired tier changes before DOM access", async () => {
  const r = runtime("example.com", { querySelector() { throw new Error("unexpected DOM read"); } });
  assert.equal(Object.keys(r.S.adapters).length, 9);
  for (const [host, adapter] of Object.entries(r.S.adapters)) {
    for (const mode of ["think", "fast", "thinkImage", "fastImage"].filter(key => adapter[key]))
      await assert.rejects(adapter[mode](999), /timeout/, host + " " + mode);
  }
});

test("DeepSeek normal tier changes still reach their intended toggle", async () => {
  let on = false; const clicks = [];
  const toggle = { getAttribute: () => String(on), dispatchEvent: e => {
    if (e.type === "click") { on = !on; clicks.push(on); }
  }, textContent: "DeepThink" };
  const r = runtime("deepseek.com", { querySelectorAll: selector => selector === '.ds-toggle-button' ? [toggle] : [] });
  assert.equal(await r.S.runMode("think", true, 4000), true);
  assert.equal(await r.S.runMode("fast", true, 4000), true);
  assert.deepEqual(clicks, [true, false]);
});

test("queued tier changes retain their original deadline", async () => {
  const r = runtime("example.com"); let calls = 0;
  r.S.adapters["example.com"] = { think: async deadline => { calls++; await r.S.sleep(600, deadline); } };
  const first = r.S.runMode("think", true, 3000);
  const second = r.S.runMode("think", true, 1500);
  assert.equal(await first, true);
  assert.equal(await second, false);
  assert.equal(calls, 1);
});

test("broadcast deadline stops slow tier work before any composer injection", async () => {
  let focused = 0;
  const composer = { focus: () => { focused++; },
    getBoundingClientRect: () => ({ width: 200, height: 30, bottom: 30, top: 0, right: 200, left: 0 }) };
  const entry = { classList: { contains: () => false }, click() {},
    querySelector: selector => ({ textContent: selector === ".name" ? "K3" : "Standard" }) };
  const r = runtime("kimi.com", { querySelector: () => entry,
    querySelectorAll: selector => selector.includes("textarea") ? [composer] : [] });
  const result = await r.dispatch({ cmd: "submitPrompt", text: "must not be injected", tier: "think", deadline: 1400 });
  assert.equal(result.ok, false);
  assert.equal(result.code, "timeout");
  assert.equal(focused, 0);
  assert.equal(r.now(), 1400);
});

test("tier failure within its own budget still permits broadcast submission", async () => {
  let focused = 0, value = "";
  const composer = { tagName: "DIV", textContent: "", focus: () => { focused++; },
    getBoundingClientRect: () => ({ width: 200, height: 30, bottom: 30, top: 0, right: 200, left: 0 }) };
  const r = runtime("example.com", { querySelectorAll: () => [composer] });
  r.S.adapters["example.com"] = {
    think: async deadline => { await r.S.sleep(20000, deadline); }, state: () => "fast",
    inject: (el, text) => { value = text; el.textContent = text; return true; },
    submit: () => { composer.textContent = ""; return true; },
  };
  const result = await r.dispatch({ cmd: "submitPrompt", text: "offline fixture", tier: "think", deadline: 20000 });
  assert.equal(result.ok, true);
  assert.equal(result.code, "tier_unconfirmed");
  assert.equal(value, "offline fixture");
  assert.equal(focused, 1);
  assert.ok(r.now() < 20000);
});

test("menu selectors clean up even when their own wait reaches deadline", async () => {
  const entry = { getAttribute: () => null, dispatchEvent() {} };
  const r = runtime("claude.ai", { querySelector: selector => selector.includes('model-selector-dropdown') ? entry : null });
  await assert.rejects(r.S.adapters["claude.ai"]._selectModel(/Fable/, 1400), /timeout/);
  assert.equal(r.now(), 1400);
  assert.equal(r.events.filter(type => type === "keydown").length, 2, "private action owns its Escape cleanup");
});

test("Kimi timeout closes its active root menu even when Escape is ignored", async () => {
  let active = false; const clicks = [];
  const entry = { classList: { contains: () => active }, click() { active = !active; clicks.push(active ? "open" : "close"); },
    querySelector: selector => ({ textContent: selector === ".name" ? "K3" : "Standard" }) };
  const r = runtime("kimi.com", { querySelector: () => entry, querySelectorAll: () => [] });
  await assert.rejects(r.S.adapters["kimi.com"]._setEffort(/Max/, 1400), /timeout/);
  assert.equal(active, false);
  assert.deepEqual(clicks, ["open", "close"]);
  assert.equal(r.now(), 1400, "cleanup may close a menu but cannot start another wait");
});

test("GLM timeout closes the visible tooltip without selecting any tier", async () => {
  let active = false;
  const trigger = { click: () => { active = !active; }, dispatchEvent() {} };
  const item = { getBoundingClientRect: () => ({ height: active ? 30 : 0 }) };
  const r = runtime("chatglm.cn", { querySelector: () => trigger, querySelectorAll: () => [item] });
  await assert.rejects(r.S.adapters["chatglm.cn"]._pick("极致", true, 1200), /timeout/);
  assert.equal(active, false);
  assert.equal(r.now(), 1200);
});

test("Gemini timeout closes its model menu when Escape is ignored", async () => {
  let active = false;
  const button = { getAttribute: name => name === "aria-expanded" ? String(active) : "mode picker",
    dispatchEvent: e => { if (e.type === "click") active = !active; } };
  const item = { textContent: "unavailable tier", getBoundingClientRect: () => ({ width: 100, height: active ? 30 : 0 }) };
  const r = runtime("gemini.google.com", { querySelector: () => button,
    querySelectorAll: selector => selector === "button" ? [button] : [item] });
  await assert.rejects(r.S.adapters["gemini.google.com"]._selectModel(/Pro/, 1200), /timeout/);
  assert.equal(active, false);
  assert.equal(r.now(), 1200);
});
