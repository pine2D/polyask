const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function fixture(options = {}) {
  const state = { model: options.model ?? "Qwen3.7-Max", mode: "快速", open: false, clicks: [], closed: 0, settled: !options.settling };
  const base = (extra = {}) => ({ children: [], getAttribute: () => null,
    getBoundingClientRect: () => ({ width: 80, height: 30 }), closest: () => null, ...extra });
  const trigger = base({ get textContent() { return state.model; },
    closest: selector => selector === ".desktop-no-drag" ? {} : null,
    getAttribute: name => name === "aria-controls" && !options.noControls ? "model-dialog" : null,
    click() { state.clicks.push(options.cards ? "ignored-trigger-click" : "trigger"); if (!options.cards) state.open = true; } });
  // Object spread copies a getter's current value; keep this one live for the re-read assertion.
  Object.defineProperty(trigger, "textContent", { get: () => state.model });
  const choices = (options.choices ?? [{ text: "Qwen3.7-千问" }]).map(choice => base({
    tagName: options.cards ? "DIV" : "LI", textContent: options.cards ? choice.text + " 模型描述 设为默认" : choice.text,
    modelLabel: choice.text,
    getBoundingClientRect: () => ({ width: choice.hidden ? 0 : 80, height: 30 }),
    getAttribute: name => name === "aria-disabled" && choice.disabled ? "true" : null,
    click() { state.clicks.push(choice.text); state.open = false;
      if (!options.swallowed) state.model = choice.text; },
  }));
  const labels = choices.map(card => base({ textContent: card.modelLabel,
    closest: selector => selector === "div.group.cursor-pointer" ? card : null }));
  const heading = base({ textContent: options.title ?? "模型" });
  const dialog = base({
    getAttribute: name => name === "role" ? "dialog" : name === "aria-labelledby" && !options.cards ? "model-heading" : null,
    getBoundingClientRect: () => ({ width: state.open && !options.hiddenDialog ? 500 : 0, height: 400 }),
    contains: node => choices.includes(node) || labels.includes(node),
    querySelectorAll(selector) {
      if (selector === 'li,[role="option"],[role="menuitem"],[role="menuitemradio"]') return options.cards ? [] : choices;
      if (selector === "div.truncate") return options.cards ? labels : [];
      if (selector === 'h1,h2,h3,[role="heading"]') return options.cards ? [] : [heading];
      if (selector === 'h1,h2,h3,[role="heading"],header') return [heading];
      return [];
    },
  });
  const body = base({ textContent: "Qwen3.7-千问", click() { state.clicks.push("body"); } });
  const button = base({ querySelectorAll: () => [], textContent: "思考",
    getBoundingClientRect: () => ({ width: options.hiddenMode ? 0 : 80, height: 30 }),
    getAttribute: name => options.legacy ? null : name === "aria-haspopup" ? "menu" : name === "aria-label" ? state.mode : null,
    click() { state.mode = state.mode === "快速" ? "思考研究" : "快速"; },
    dispatchEvent() { state.open = true; } });
  Object.defineProperty(button, "className", { get: () => state.mode === "思考研究" ? "text-theme" : "" });
  const modeItems = ["快速", "思考研究"].map(text => base({ textContent: text,
    click() { state.mode = text; state.open = false; } }));
  const document = { getElementById: id => id === "model-dialog" && !options.brokenControls ? dialog
    : id === "model-heading" ? heading : null, querySelectorAll(selector) {
    if (selector === '[aria-haspopup="dialog"]') return [trigger];
    if (selector === "div,button,span") return [trigger, body];
    if (selector === "div,li,span,button") return state.open ? [trigger, ...choices, body] : [trigger, body];
    if (selector === '[role="dialog"]') return [dialog];
    if (selector === 'li,[role="option"],[role="menuitem"],[role="menuitemradio"]') return state.open && !options.cards ? choices : [];
    if (selector === "button") return [button];
    if (selector === 'button[aria-haspopup="menu"]') return options.legacy ? [] : [button];
    if (selector === '[role="menuitemcheckbox"]') return state.open ? modeItems : [];
    return [];
  } };
  const S = { ...require("./lib/deadline-harness"), adapters: {},
    openMenu(el) { assert.equal(el === trigger, true); if (!state.settled) return; state.open = true; state.clicks.push("trigger"); },
    waitFor: async fn => fn(), sleep: async ms => { if (ms >= 500) state.settled = true; }, escMenus() { state.open = false; state.closed++; },
    findByText: (selector, re) => document.querySelectorAll(selector).find(node => re.test(node.textContent || "")),
  };
  const context = { document, window: { __AMS: S }, t: key => key,
    MouseEvent: class { constructor(type) { this.type = type; } } };
  for (const file of ["selection-match.js", "adapters-cn4.js"])
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../src/site-runtime", file), "utf8"), context);
  return { adapter: S.adapters["qianwen.com"], state, trigger };
}
const selection = (adapter, mode) => {
  assert.equal(typeof adapter.selection, "function", "站点须提供只读切档证据");
  return JSON.parse(JSON.stringify(adapter.selection(mode)));
};

test("模型控件中的规范别名与模式共同证明首选，陌生模型不冒充预设", async () => {
  const { adapter, state } = fixture({ model: "Qwen3.7-千问" });
  assert.deepEqual(selection(adapter, "fast"), { outcome: "preferred", observed: "fast", model: "Qwen3.7-千问" });
  await adapter.think();
  assert.deepEqual(selection(adapter, "think"), { outcome: "preferred", observed: "think", model: "Qwen3.7-千问" });
  for (const model of ["Qwen3.7-Max", "Qwen3.7-千问-Max", "Qwen3.7-千问 Pro", "Qwen3.8-千问"]) {
    state.model = model;
    assert.equal(adapter.state(), null, model);
    assert.equal(selection(adapter, "think").outcome, "unconfirmed", model);
  }
  assert.equal(state.clicks.length, 0, "精确模型已选时不应再次打开菜单，读取也无副作用");
});

test("真实模型候选匹配归一化标点，并在点击后复读当前入口", async () => {
  const { adapter, state } = fixture({ choices: [{ text: "Qwen3.7–千问" }] });
  await adapter.fast();
  assert.deepEqual(state.clicks, ["trigger", "Qwen3.7–千问"]);
  assert.deepEqual(selection(adapter, "fast"), { outcome: "preferred", observed: "fast", model: "Qwen3.7-千问" });
  assert.ok(state.closed > 0);
});

for (const choices of [
  [{ text: "Qwen3.7-千问", disabled: true }], [{ text: "Qwen3.7-千问", hidden: true }],
  [{ text: "Qwen3.7-千问" }, { text: "Qwen3.7-千问" }], [{ text: "Qwen3.8-千问" }], [],
]) {
  test(`无唯一可用的维护模型时不点击：${JSON.stringify(choices)}`, async () => {
    const { adapter, state } = fixture({ choices });
    await assert.rejects(() => adapter.fast(), /模型选项未找到/);
    assert.deepEqual(state.clicks, ["trigger"]);
    assert.equal(state.open, false);
  });
}

test("模型点击被吞时必须失败，不能把已调用 click 视为确认", async () => {
  const { adapter, state } = fixture({ swallowed: true });
  await assert.rejects(() => adapter.fast(), /模型未生效/);
  assert.equal(selection(adapter, "fast").outcome, "unconfirmed");
  assert.equal(state.open, false);
});

test("只读证据每次重读模式，不能沿用上次已确认模型组合", () => {
  const { adapter, state } = fixture({ model: "Qwen3.7-千问" });
  assert.equal(selection(adapter, "fast").outcome, "preferred");
  state.mode = "思考研究";
  assert.deepEqual(selection(adapter, "fast"), { outcome: "unconfirmed", observed: "think" });
  assert.equal(state.clicks.length, 0);
});


test("旧版裸思考控件可确认模式，隐藏控件不得作为当前切档证据", async () => {
  const { adapter } = fixture({ model: "Qwen3.7-千问", legacy: true });
  assert.equal(selection(adapter, "fast").outcome, "preferred");
  await adapter.think();
  assert.equal(selection(adapter, "think").outcome, "preferred");
  const hidden = fixture({ model: "Qwen3.7-千问", legacy: true, hiddenMode: true });
  assert.deepEqual(selection(hidden.adapter, "fast"), { outcome: "unconfirmed" });
});


test("真实 DIV 模型卡在受控对话框内选中，菜单用 openMenu 打开而非无效 click", async () => {
  const { adapter, state } = fixture({ cards: true, choices: [{ text: "Qwen3.7–千问" }] });
  await adapter.fast();
  assert.deepEqual(state.clicks, ["trigger", "Qwen3.7–千问"]);
  assert.equal(selection(adapter, "fast").outcome, "preferred");
});

test("无 aria-controls 的旧布局只在具有模型标题的可见对话框中找卡片", async () => {
  const { adapter, state } = fixture({ cards: true, noControls: true });
  await adapter.fast();
  assert.deepEqual(state.clicks, ["trigger", "Qwen3.7-千问"]);
});

for (const options of [
  { cards: true, hiddenDialog: true }, { cards: true, brokenControls: true },
  { cards: true, noControls: true, title: "设置" },
  { cards: true, choices: [{ text: "Qwen3.7-千问", hidden: true }] },
  { cards: true, choices: [{ text: "Qwen3.7-千问", disabled: true }] },
  { cards: true, choices: [{ text: "Qwen3.7-千问" }, { text: "Qwen3.7-千问" }] },
]) {
  test(`DIV 卡片路径拒绝不明确的弹窗及不可用候选：${JSON.stringify(options)}`, async () => {
    const { adapter, state } = fixture(options);
    await assert.rejects(() => adapter.fast(), /模型选项未找到/);
    assert.deepEqual(state.clicks, ["trigger"]);
    assert.equal(state.open, false);
  });
}


test("上次关闭动画未结束时先等菜单稳定，再打开模型卡片", async () => {
  const { adapter, state } = fixture({ cards: true, settling: true });
  await adapter.fast();
  assert.deepEqual(state.clicks, ["trigger", "Qwen3.7-千问"]);
});
