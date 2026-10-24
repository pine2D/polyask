"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { JSDOM } = require("jsdom");

// 2026-10-24 真机菜单形态的合成夹具；只替代站点菜单事件与时钟，运行生产 core/tier/adapter。
function runtime(t, options = {}) {
  const dom = new JSDOM('<body><div class="current-model"><span class="name"></span>'
    + '<span class="current-effort"></span></div></body>', { url: "https://www.kimi.com/" });
  t.after(() => dom.window.close());
  const { document } = dom.window;
  const entry = document.querySelector(".current-model");
  const model = entry.querySelector(".name"), effort = entry.querySelector(".current-effort");
  model.textContent = options.model ?? "K3.1 Pro";
  effort.textContent = options.effort ?? "High";
  let now = 1000;
  const clicks = [];
  function removeEfforts() { document.querySelector(".effort-menu")?.remove(); }
  function openEfforts() {
    if (document.querySelector(".effort-menu")) return;
    const menu = document.createElement("div"); menu.className = "effort-menu";
    for (const label of options.efforts ?? ["Standard", "High", "Max"]) {
      const item = document.createElement("div"); item.className = "effort-option";
      const name = document.createElement("span"); name.className = "effort-name";
      name.textContent = label; item.append(name);
      item.addEventListener("click", () => { clicks.push("effort:" + label); effort.textContent = label; });
      menu.append(item);
    }
    document.body.append(menu);
  }
  entry.addEventListener("click", () => {
    const active = entry.classList.toggle("active"); clicks.push(active ? "open" : "close");
    if (!active) { document.querySelector(".model-menu")?.remove(); removeEfforts(); return; }
    const menu = document.createElement("div"); menu.className = "model-menu";
    for (const label of options.models ?? ["K3.1 Pro", "K2.8", "Instant"]) {
      const item = document.createElement("div"); item.className = "model-item";
      const name = document.createElement("span"); name.className = "name";
      name.textContent = label; item.append(name);
      item.addEventListener("click", () => { clicks.push("model:" + label); model.textContent = label; });
      menu.append(item);
    }
    for (const label of ["Context Length", "Thinking effort"]) {
      const row = document.createElement("div"); row.className = "effort-item";
      const title = document.createElement("span"); title.className = "effort-title";
      title.textContent = label; row.append(title);
      if (label === "Thinking effort") row.addEventListener("mouseenter", openEfforts);
      menu.append(row);
    }
    document.body.append(menu);
  });
  // 真站 Escape 只收子菜单，根菜单仍须适配器回点入口。
  document.body.addEventListener("keydown", event => { if (event.key === "Escape") removeEfforts(); });
  const context = vm.createContext({
    window: dom.window, document, location: dom.window.location,
    MouseEvent: dom.window.MouseEvent, KeyboardEvent: dom.window.KeyboardEvent,
    t: key => key, console: { debug() {} }, Date: { now: () => now },
    setTimeout: (fn, ms) => { now += ms; fn(); },
  });
  for (const file of ["core.js", "tier.js", "adapters-cn2.js"])
    vm.runInContext(fs.readFileSync(path.join(__dirname, "../src/site-runtime", file), "utf8"), context);
  const S = dom.window.__AMS;
  return { adapter: S.adapters["kimi.com"], S, document, entry, clicks, now: () => now };
}

test("Kimi state recognizes only K3.1 Pro preset efforts without opening menus", t => {
  const cases = [
    ["K3.1 Pro", "Max", "think"], ["K3.1 Pro", "Standard", "fast"], ["K3.1 Pro", "High", null],
    [" \u200bK3.1 Pro\ufeff ", "\u200dMax", "think"], ["K3.1 Pro", "标准", "fast"],
    ["K3.1 Pro", "极致", "think"], ["K3", "Max", null], ["K3", "Standard", null],
    ["K2.8", "Max", null], ["K2.8", "Standard", null], ["Instant", "Standard", null],
    ["K3.1 Pro Max", "Max", null], ["K3.1", "Standard", null],
  ];
  for (const [model, effort, expected] of cases) {
    const r = runtime(t, { model, effort });
    const before = r.document.body.innerHTML;
    assert.equal(r.adapter.state(), expected, model + " / " + effort);
    assert.equal(r.document.body.innerHTML, before, "state must remain read-only");
    assert.deepEqual(r.clicks, []);
  }
});

for (const [mode, expected] of [["think", "Max"], ["fast", "Standard"]]) {
  test("Kimi " + mode + " selects K3.1 Pro and confirms its effort with both menus closed", async t => {
    const r = runtime(t, { model: "K2.8" });
    assert.equal(await r.S.runMode(mode, true, 10000), true);
    assert.equal(r.adapter.state(), mode);
    assert.deepEqual(r.clicks, ["open", "model:K3.1 Pro", "close", "open", "effort:" + expected, "close"]);
    assert.equal(r.entry.classList.contains("active"), false);
    assert.equal(r.document.querySelectorAll(".model-item, .effort-option").length, 0);
  });

  test("Kimi " + mode + " is idempotent and still closes an already open root menu", async t => {
    const r = runtime(t, { effort: expected });
    await r.adapter[mode](10000);
    assert.deepEqual(r.clicks, [], "already selected presets must not reopen menus");
    r.entry.click(); r.clicks.length = 0;
    await r.adapter[mode](10000);
    assert.deepEqual(r.clicks, ["close"]);
    assert.equal(r.entry.classList.contains("active"), false);
  });
}

test("Kimi model selection strips zero-width characters and rejects nearby model names", async t => {
  const target = "\u200bK3.1 Pro\ufeff";
  const r = runtime(t, { model: "Instant", models: ["K3", "K3.1 Pro Max", target] });
  assert.equal(await r.S.runMode("think", true, 10000), true);
  assert.equal(r.adapter.state(), "think");
  assert.deepEqual(r.clicks.filter(value => value.startsWith("model:")), ["model:" + target]);
});

test("Kimi missing K3.1 Pro throws and closes the menu without selecting another model", async t => {
  const r = runtime(t, { model: "K2.8", models: ["K3", "K2.8", "Instant"] });
  await assert.rejects(r.adapter.think(10000), /目标选项未找到/);
  assert.deepEqual(r.clicks, ["open", "close"]);
  assert.equal(r.entry.classList.contains("active"), false);
});

test("Kimi missing Max throws and closes the root menu without selecting High", async t => {
  const r = runtime(t, { efforts: ["Standard", "High"] });
  await assert.rejects(r.adapter.think(10000), /目标思考强度未找到/);
  assert.deepEqual(r.clicks, ["open", "close"]);
  assert.equal(r.entry.classList.contains("active"), false);
});

test("Kimi missing model entry never silently reports a tier switch", async t => {
  const r = runtime(t); r.entry.remove();
  await assert.rejects(r.adapter.think(10000), /模型入口未找到/);
  await assert.rejects(r.adapter.fast(10000), /模型入口未找到/);
  assert.deepEqual(r.clicks, []);
});

test("Kimi effort deadline closes the menu without selecting an option or starting another wait", async t => {
  const r = runtime(t, { efforts: [] });
  await assert.rejects(r.adapter.think(1400), /timeout/);
  assert.deepEqual(r.clicks, ["open", "close"]);
  assert.equal(r.entry.classList.contains("active"), false);
  assert.equal(r.now(), 1400);
});
