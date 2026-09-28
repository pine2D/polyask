const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

// 页面可完全移除模型入口；DOM 桩仅模拟站点响应，真实运行适配器的选择、点击、复读与诊断。
function fixture(options = {}) {
  const state = { mode: "快速", open: false, actions: 0, model: options.model ?? null };
  const rect = (visible = true) => ({ width: visible ? 80 : 0, height: visible ? 32 : 0 });
  const tab = {
    textContent: options.tab ?? "日常", getBoundingClientRect: () => rect(!options.hiddenTab),
    getAttribute: name => name === "aria-selected" ? (options.unselected ? "false" : "true") : null,
  };
  const button = {
    get textContent() { return state.mode; }, children: [], querySelectorAll: () => [],
    getBoundingClientRect: () => rect(!options.hiddenButton),
    getAttribute: name => name === "aria-haspopup" ? "menu" : name === "aria-label" ? state.mode : null,
    dispatchEvent() { state.open = true; state.actions++; },
  };
  const items = (options.missingOption ? ["快速"] : ["快速", "思考研究"]).map(text => ({
    textContent: text, getBoundingClientRect: () => rect(state.open),
    click() { state.actions++; if (!options.swallowed) state.mode = text; state.open = false; },
  }));
  const model = { getAttribute: () => null, getBoundingClientRect: () => rect(), get textContent() { return state.model; }, children: [],
    closest: selector => selector === ".desktop-no-drag" && options.header ? {} : null };
  const document = { querySelectorAll(selector) {
    if (selector === "div,button,span") return state.model ? [model] : [];
    if (selector === '[role="tab"][aria-selected="true"]') return options.unselected ? [] : [tab];
    if (selector === 'button[aria-haspopup="menu"]' || selector === "button") return options.noButton ? [] : [button];
    if (selector === '[role="menuitemcheckbox"]') return state.open ? items : [];
    return [];
  } };
  const S = {
    ...require("./lib/deadline-harness"), adapters: {},
    findComposer: () => options.noComposer ? null : {},
    waitFor: async fn => fn(), sleep: async () => {},
    escMenus() { state.open = false; }, findByText() {}, openMenu() {}, clickEl() {},
  };
  const context = { document, window: { __AMS: S }, t: key => key,
    MouseEvent: class { constructor(type) { this.type = type; } } };
  for (const file of ["selection-match.js", "adapters-cn4.js"])
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../src/site-runtime", file), "utf8"), context);
  return { adapter: S.adapters["qianwen.com"], state, tab, button };
}

for (const tab of ["日常", "Daily"]) {
  test(`无模型入口的 ${tab} 页面可切思考与快速，诊断只读且保留模型缺失提示`, async () => {
    const { adapter, state } = fixture({ tab });
    assert.equal(adapter.state(), "fast");
    const checks = adapter.diagnose();
    assert.equal(checks.find(c => c.name === "diag_modelDropdown").kind, "tier");
    assert.equal(checks.find(c => c.name === "diag_modelDropdown").ok, false);
    assert.equal(checks.filter(c => c.kind !== "tier").every(c => c.ok), true);
    assert.equal(state.actions, 0, "读取状态和诊断不能打开菜单");
    await adapter.think(Date.now() + 10000);
    assert.equal(state.mode, "思考研究");
    assert.equal(adapter.state(), "think");
    assert.equal(state.open, false);
    await adapter.fast(Date.now() + 10000);
    assert.equal(state.mode, "快速");
    assert.equal(adapter.state(), "fast");
    assert.equal(state.open, false);
  });
}

for (const options of [
  { tab: "工作" }, { tab: "Work" }, { tab: "" }, { unselected: true },
  { hiddenTab: true }, { noComposer: true }, { noButton: true }, { hiddenButton: true },
]) {
  test(`未确认日常页面就绪时不放行：${JSON.stringify(options)}`, async () => {
    const { adapter, state } = fixture(options);
    assert.equal(adapter.state(), null);
    assert.equal(adapter.diagnose().find(c => c.name === "diag_modelDropdown").kind, "control");
    await assert.rejects(() => adapter.think(Date.now() + 10000), /模型下拉未就绪/);
    assert.equal(state.actions, 0);
  });
}

test("无模型入口且思考选项缺失时仍失败并收菜单", async () => {
  const { adapter, state } = fixture({ missingOption: true });
  await assert.rejects(() => adapter.think(Date.now() + 10000), /模式选项未找到/);
  assert.equal(state.mode, "快速");
  assert.equal(state.open, false);
});

test("无模型入口且点击被吞时仍失败并收菜单", async () => {
  const { adapter, state } = fixture({ swallowed: true });
  await assert.rejects(() => adapter.think(Date.now() + 10000), /思考开关未生效/);
  assert.equal(adapter.state(), "fast");
  assert.equal(state.open, false);
});

test("无模型入口兼容分支不绕过截止时间", async () => {
  const { adapter, state } = fixture();
  await assert.rejects(() => adapter.think(Date.now() - 1), /timeout/);
  assert.equal(state.actions, 0);
});

test("日常标签切到工作后不沿用先前的模式识别", () => {
  const { adapter, tab } = fixture();
  assert.equal(adapter.state(), "fast");
  tab.textContent = "工作";
  assert.equal(adapter.state(), null);
  assert.equal(adapter.diagnose().find(c => c.name === "diag_modelDropdown").kind, "control");
});


test("正文中的模型名不能冒充入口或阻止模式切换", async () => {
  const { adapter, state } = fixture({ model: "Qwen3.7-Max" });
  assert.equal(adapter.state(), "fast");
  assert.equal(adapter.diagnose().find(c => c.name === "diag_modelDropdown").ok, false);
  await adapter.think(Date.now() + 10000);
  assert.equal(state.mode, "思考研究");
});

test("延迟水合的顶部模型文字仍有效，入口恢复后重新施加模型约束", () => {
  const { adapter, state } = fixture({ header: true });
  assert.equal(adapter.state(), "fast");
  state.model = "Qwen3.7-Max";
  assert.equal(adapter.state(), null);
  assert.equal(adapter.diagnose().find(c => c.name === "diag_modelDropdown").kind, "control");
  state.model = "Qwen3.7-千问";
  assert.equal(adapter.state(), "fast");
});

test("当前模型证据出现或消失时分别报告首选和仅模式，不缓存前次模型", () => {
  const { adapter, state } = fixture({ header: true });
  const read = () => JSON.parse(JSON.stringify(adapter.selection("fast")));
  assert.deepEqual(read(), { outcome: "mode_only", observed: "fast" });
  state.model = "Qwen3.7-千问";
  assert.deepEqual(read(), { outcome: "preferred", observed: "fast", model: "Qwen3.7-千问" });
  state.model = null;
  assert.deepEqual(read(), { outcome: "mode_only", observed: "fast" });
  assert.equal(state.actions, 0);
});
