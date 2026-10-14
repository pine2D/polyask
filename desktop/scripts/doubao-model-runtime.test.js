"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const { source, helpers } = require("./lib/site-send-harness");

function fixture({ ignoreClick = false, disabled = false, hidden = false, unrelated = false, ambiguous = false,
  ignoreEscape = false } = {}) {
  let selected = "fast", open = false, version = 0;
  const events = [];
  const rect = () => ({ x: 380, y: 800, width: 32, height: 32 });
  const trigger = () => ({ id: "model-" + version });
  const button = () => ({ textContent: "", getBoundingClientRect: rect,
    getAttribute: name => name === "data-testid" ? "chat_input_action_model" : null,
    closest: () => trigger() });
  let currentButton = button();
  const makeItem = mode => ({ textContent: "豆包 " + (mode === "fast" ? "快速" : "专家"),
    getBoundingClientRect: () => ({ width: hidden && mode === "think" ? 0 : 200, height: 40 }),
    getAttribute: name => name === "data-disabled" && disabled && mode === "think" ? "" : null,
    querySelector: selector => selector === ":scope > svg" && (selected === mode || ambiguous) ? {} : null,
    click() { events.push(mode); if (!ignoreClick) selected = mode; open = false; version++; currentButton = button(); }
  });
  const items = [makeItem("fast"), makeItem("think")];
  const menu = { getBoundingClientRect: () => ({ width: open ? 240 : 0, height: 80 }),
    getAttribute: name => name === "aria-labelledby" ? (unrelated ? "other-control" : "model-" + version)
      : name === "data-state" ? (open ? "open" : "closed") : null,
    querySelectorAll: selector => selector === '[role="menuitem"]' ? items : [] };
  const document = {
    querySelector: selector => selector === 'button[data-testid="chat_input_action_model"]' ? currentButton : null,
    querySelectorAll: selector => selector === "button" ? [currentButton]
      : selector === '[role="menu"]' ? [menu] : selector === '[role="menuitem"]' && open ? items : []
  };
  const context = helpers(document, {
    findComposer: () => ({ getBoundingClientRect: rect }),
    openMenu(node) { assert.equal(node === currentButton, true, "每次开菜单必须使用重绘后的当前按钮"); open = true; events.push("open"); },
    escMenus() { if (!ignoreEscape) open = false; events.push("close"); },
    clickEl(node) { assert.equal(node === currentButton, true); open = false; events.push("retrigger-close"); }
  });
  vm.runInNewContext(source("adapters-cn.js"), context);
  return { adapter: context.window.__AMS.adapters["doubao.com"], events,
    selected: () => selected, isOpen: () => open, button: () => currentButton,
    open() { open = true; } };
}

test("豆包新版图标入口按 testid 识别，关闭菜单时不猜档位", () => {
  const f = fixture();
  assert.equal(f.adapter._modeBtn() === f.button(), true);
  assert.equal(f.adapter.state(), null);
  assert.equal(f.adapter.diagnose()[0].ok, true);
  assert.equal(f.events.length, 0, "只读状态和诊断不打开菜单");
});

test("豆包菜单选中态只读可判，动作结束不缓存已关闭菜单的状态", async () => {
  const f = fixture();
  f.open();
  assert.equal(f.adapter.state(), "fast");
  await f.adapter.think();
  assert.equal(f.selected(), "think");
  assert.equal(f.isOpen(), false);
  assert.equal(f.adapter.state(), null);
  await f.adapter.fast();
  assert.equal(f.selected(), "fast");
  assert.equal(f.isOpen(), false);
  assert.equal(f.adapter.state(), null);
});

test("豆包新版点击被吞不能确认成功", async () => {
  const f = fixture({ ignoreClick: true });
  await assert.rejects(() => f.adapter.think());
  assert.equal(f.selected(), "fast");
  assert.equal(f.isOpen(), false);
});

test("豆包只使用 model 入口关联的菜单", async () => {
  const f = fixture({ unrelated: true });
  await assert.rejects(() => f.adapter.think());
  assert.equal(f.events.includes("think"), false);
  assert.equal(f.isOpen(), false);
});

test("豆包隐藏或禁用专家项不点击", async () => {
  for (const options of [{ hidden: true }, { disabled: true }]) {
    const f = fixture(options);
    await assert.rejects(() => f.adapter.think());
    assert.equal(f.events.includes("think"), false);
    assert.equal(f.isOpen(), false);
  }
});

test("豆包重复选中标记不能当可读档位", () => {
  const f = fixture({ ambiguous: true });
  f.open();
  assert.equal(f.adapter.state(), null);
  assert.equal(f.events.length, 0);
});

test("豆包只读选中证据排除隐藏项目", () => {
  const f = fixture({ ambiguous: true, hidden: true });
  f.open();
  assert.equal(f.adapter.state(), "fast", "隐藏专家勾不影响可见快速勾");
  assert.equal(f.events.length, 0);
});

test("豆包 Escape 失效时回点当前入口关闭菜单", async () => {
  const f = fixture({ ignoreEscape: true });
  await f.adapter.think();
  assert.equal(f.selected(), "think");
  assert.equal(f.isOpen(), false);
  assert.equal(f.events.includes("retrigger-close"), true);
});
