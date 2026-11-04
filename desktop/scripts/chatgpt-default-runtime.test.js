"use strict";
const tests = [];
const test = (name, run) => tests.push({ name, run });
const assert = require("node:assert/strict");
const { defaultCase } = require("./lib/chatgpt-default-harness");

test("Default fast chooses the second preset Sol Light, not Luna High or legacy 5.6", async () => {
  const c = defaultCase({ index: 5 });
  try {
    const result = await c.adapter.fast(11000);
    assert.equal(c.state.index, 1);
    assert.equal(c.state.selected, "Default");
    assert.equal(c.adapter.state(), "fast");
    assert.equal(result.model, "GPT-6.1 Sol");
    assert.equal(c.state.clicks.includes("GPT-5.6 Sol"), false);
    assert.equal(c.state.open, false);
    assert.equal(c.w.document.querySelector("textarea").value, "existing draft");
  } finally { c.close(); }
});

test("Default think starts from the active model list and confirms Astra Extra High", async () => {
  const c = defaultCase({ index: 1, view: "models", selected: "GPT-6.1 Sol" });
  try {
    const result = await c.adapter.think(11000);
    assert.equal(c.state.index, 5);
    assert.equal(c.state.selected, "Default");
    assert.equal(c.adapter.state(), "think");
    assert.equal(result.model, "GPT-6 Astra");
    assert.equal(c.state.open, false);
  } finally { c.close(); }
});

test("closed Default preset labels produce exact read-only evidence; Luna and middle presets do not", () => {
  for (const [label, mode, model] of [["GPT-6.1 Sol Light", "fast", "GPT-6.1 Sol"],
    ["GPT-6 Astra Extra High", "think", "GPT-6 Astra"], ["GPT-6 Luna High", null],
    ["GPT-6.1 Sol Medium", null], ["GPT-6 Astra Medium", null], ["GPT-6 Astra High", null]]) {
    const c = defaultCase({ label });
    try {
      assert.equal(c.adapter.state(), mode, label);
      if (mode) {
        const evidence = c.adapter.selection(mode);
        assert.equal(evidence.outcome, "preferred", label);
        assert.equal(evidence.model, model, label);
      }
      assert.equal(c.state.clicks.length, 0);
      assert.equal(c.state.open, false);
    } finally { c.close(); }
  }
});

test("fast moves right from Luna High and repeats without choosing another model", async () => {
  const c = defaultCase({ index: 0 });
  try {
    const first = await c.S.resolveTier("fast", 11000);
    assert.equal(first.outcome, "preferred");
    assert.equal(first.model, "GPT-6.1 Sol");
    assert.equal(c.state.index, 1);
    assert.equal(c.state.keys.join(","), "ArrowRight");
    const keys = c.state.keys.length;
    const repeated = await c.S.resolveTier("fast", 11000);
    assert.equal(repeated.outcome, "preferred");
    assert.equal(c.state.keys.length, keys);
    assert.equal(c.state.selected, "Default");
  } finally { c.close(); }
});

test("inactive Power cannot be used as the model-list root and is never driven", async () => {
  const c = defaultCase({ view: "models", index: 1 });
  try {
    c.state.open = true; c.render();
    assert.equal(c.adapter._power() === null, true);
    assert.equal(c.adapter._modelItems().length, 7);
    assert.equal(c.adapter._controlledMenu() !== null, true);
    const result = await c.adapter.think(11000);
    assert.equal(result.model, "GPT-6 Astra");
    assert.equal(c.state.index, 5);
  } finally { c.close(); }
});

test("unknown range, disabled/duplicate/missing Default and wrong ownership never fall back to 5.6", async () => {
  for (const options of [{ max: 6 }, { disabledDefault: true }, { disabledPower: true },
    { labels: ["Default", "Default", "GPT-6 Astra", "GPT-5.6 Sol"] },
    { labels: ["GPT-6 Astra", "GPT-5.6 Sol"] }, { wrongOwner: true }]) {
    const c = defaultCase(options);
    try {
      await assert.rejects(() => c.adapter.fast(11000));
      assert.equal(c.state.clicks.includes("GPT-5.6 Sol"), false);
      assert.equal(c.state.keys.length, 0);
      assert.equal(c.state.open, false);
    } finally { c.close(); }
  }
});

test("swallowed model/key actions and mismatching visible model cannot claim success", async () => {
  for (const options of [{ swallowModel: true }, { swallowKeys: true, index: 5 },
    { label: "GPT-6 Luna High" }, { label: "GPT-6 Astra High" },
    { label: "GPT-6.1 Sol Medium" }]) {
    const c = defaultCase(options);
    try {
      await assert.rejects(() => c.adapter.fast(11000));
      assert.equal(c.state.open, false);
      assert.equal(c.state.clicks.includes("GPT-5.6 Sol"), false);
    } finally { c.close(); }
  }
});

test("expired deadline prevents model changes and never leaves a menu open", async () => {
  const c = defaultCase();
  try {
    await assert.rejects(() => c.adapter.fast(999), /timeout/);
    assert.equal(c.state.clicks.length, 0);
    assert.equal(c.state.keys.length, 0);
    assert.equal(c.state.open, false);
  } finally { c.close(); }
});

test("open Default menu cannot prove the requested model from the slider endpoint alone", () => {
  for (const [index, mode] of [[0, "fast"], [1, "fast"], [5, "think"]]) {
    const c = defaultCase({ index });
    try {
      c.state.open = true; c.render();
      assert.equal(c.adapter.selection(mode).outcome, "unconfirmed", "index=" + index);
      assert.equal(c.state.keys.length, 0);
      assert.equal(c.state.clicks.length, 0);
    } finally { c.close(); }
  }
});

test("deadline during a slide prevents further keys and closes the menu", async () => {
  const c = defaultCase({ index: 5 });
  try {
    await assert.rejects(() => c.adapter.fast(1250), /timeout/);
    assert.equal(c.state.clock, 1250);
    assert.equal(c.state.keys.length, 1);
    assert.equal(c.state.open, false);
  } finally { c.close(); }
});

test("resident Default/new model rows forbid a 5.6 fallback when those rows are hidden", async () => {
  const c = defaultCase({ labels: ["Default", "GPT-6 Astra", "GPT-5.6 Sol"], view: "models", index: 1 });
  try {
    const style = c.w.document.createElement("style");
    style.textContent = '[data-pane="models"] > [role="menuitemradio"]:nth-child(-n+2){display:none}';
    c.w.document.head.append(style);
    await assert.rejects(() => c.adapter.fast(11000));
    assert.equal(c.state.clicks.includes("GPT-5.6 Sol"), false);
    assert.equal(c.state.keys.length, 0);
    assert.equal(c.state.open, false);
  } finally { c.close(); }
});

test("an unknown new-style model list cannot authorize the legacy fallback", async () => {
  for (const hideUnknown of [false, true]) {
    const c = defaultCase({ labels: ["Unknown default", "GPT-7", "GPT-5.6 Sol"], view: "models" });
    try {
      if (hideUnknown) {
        const style = c.w.document.createElement("style");
        style.textContent = '[data-pane="models"] > [role="menuitemradio"]:nth-child(-n+2){display:none}';
        c.w.document.head.append(style);
      }
      await assert.rejects(() => c.adapter.fast(11000));
      assert.equal(c.state.clicks.includes("GPT-5.6 Sol"), false);
      assert.equal(c.state.keys.length, 0);
    } finally { c.close(); }
  }
});

test("Default identity survives missing component hooks and prevents a legacy action", async () => {
  for (const missing of ["data-model-picker-power-slider", "data-model-picker-view"]) {
    const c = defaultCase({ view: "models", index: 1 });
    try {
      c.state.open = true; c.render();
      c.w.document.querySelector("[" + missing + "]").removeAttribute(missing);
      await assert.rejects(() => c.adapter.fast(11000));
      assert.equal(c.state.clicks.includes("GPT-5.6 Sol"), false);
      assert.equal(c.state.keys.length, 0);
      assert.equal(c.state.open, false);
    } finally { c.close(); }
  }
});

test("the same component hooks still support the known old two-model menu", async () => {
  const c = defaultCase({ labels: ["GPT-6", "GPT-5.6 Sol"], selected: "GPT-5.6 Sol", max: 4, legacy: true, index: 2 });
  try {
    const fast = await c.S.resolveTier("fast", 11000);
    assert.equal(fast.outcome, "mode_only");
    assert.equal(c.state.index, 0);
    assert.equal(c.state.selected, "GPT-6");
    const think = await c.S.resolveTier("think", 11000);
    assert.equal(think.outcome, "mode_only");
    assert.equal(c.state.index, 4);
    assert.equal(c.state.selected, "GPT-6");
  } finally { c.close(); }
});

test("control titles and hidden measurements cannot turn Luna High into a preset", () => {
  const c = defaultCase({ label: "Select model GPT-6 Luna High" });
  try {
    assert.equal(c.adapter.state(), null);
    const trigger = c.w.document.getElementById("trigger");
    trigger.innerHTML = '<span aria-hidden="true">GPT-6 Astra Extra High</span><span>GPT-6.1 Sol Light</span>';
    assert.equal(c.adapter.state(), "fast");
    assert.equal(c.adapter.selection("fast").model, "GPT-6.1 Sol");
  } finally { c.close(); }
});

(async () => {
  let failed = 0;
  for (const { name, run } of tests) {
    try { await run(); }
    catch (error) { failed++; process.stderr.write(name + ": " + (error.stack || error.message) + "\n"); }
  }
  if (failed) process.exitCode = 1;
  else console.log("✓ ChatGPT Default 预设、活动面板与精确确认");
})();
