#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = (file) => fs.readFileSync(path.join(__dirname, "..", file), "utf8");

function testPopupLayout() {
  const html = source("popup/popup.html"), css = source("popup/popup.css"), js = source("popup/popup.js");
  const order = ["site-status", "open-console", "think", "autoraise", "keys", "console-keys", "shortcut-help", "diag", "diagout"];
  const positions = order.map((id) => html.indexOf(`id="${id}"`));
  assert.ok(positions.every((position) => position >= 0) && positions.every((position, i) => i === 0 || position > positions[i - 1]), "popup 应严格保持 B 版信息顺序");
  assert.ok(html.includes('href="popup.css"') && !html.includes("<fieldset"), "popup 应使用 B 版连续控制面，不得退回旧 fieldset 卡片");
  assert.ok(css.includes("body{width:356px") && css.includes("grid-template-columns:70px 1fr"), "popup 应保持 B 版宽度与模式栏比例");
  assert.ok(html.includes('../console/theme.js') && css.includes(':root[data-theme="light"]') && css.includes(':root:not([data-theme])'), "popup 应复用共享主题逻辑并支持显式亮暗主题");
  assert.ok(!html.includes("<select") && html.match(/role="listbox"/g)?.length === 2 && js.includes('setupSelect("lang"') && js.includes('setupSelect("dm"'), "语言与悬浮控件应使用匹配 B 版的自定义菜单");
  for (const key of ["Alt+C", "Alt+L", "Alt+N", "Alt+P", "Alt+R"]) assert.ok(html.includes(`<kbd>${key}</kbd>`), `popup 应直接展示控制台快捷键 ${key}`);
  assert.ok(!html.includes("pop_denseHint") && !html.includes("shortcut-dialog"), "popup 不应保留无功能宣传语或隐藏式快捷键弹窗");
  assert.ok(css.includes("--ease-out:cubic-bezier(0.23,1,0.32,1)") && css.includes("transform-origin:top right") && css.includes("@starting-style") && css.includes("@media (prefers-reduced-motion:reduce)"), "popup 应使用克制的弹层与按压反馈并支持 reduced-motion");
  const pill = source("content/pill.js"); assert.ok(pill.includes("width:36px;height:24px") && pill.includes(".handle:before") && pill.includes("transition:opacity .16s var(--ease-out)") && pill.includes("prefers-reduced-motion:reduce"), "悬浮把手应扩大命中区并使用克制反馈");
  const core = source("content/core.js"); assert.ok(core.includes('setAttribute("role", "status")') && core.includes("pointer-events:none") && core.includes("matchMedia(\"(prefers-reduced-motion: reduce)\")") && core.includes(".animate(") && core.includes("exit.finished.then"), "跨站提示应具备状态语义、克制进退场与 reduced-motion");
}

function testConsoleControls() {
  const js = source("console/library.js"), html = source("console/console.html");
  const css = source("console/console.css");
  assert.ok(!html.includes('id="more"') && !html.includes('id="proxies"'), "console 不应保留 More 或隐藏代理控件");
  const archive = html.match(/<button id="archive"[\s\S]*?<\/button>/)?.[0] || "";
  assert.ok(archive.includes('class="icon"') && archive.includes("<svg"), "归档应作为 console 独立 SVG 图标");
  assert.ok(!js.includes("renderMore") && !js.includes("dispatchMore") && !js.includes("amsTemplates"), "console 物料层只保留快捷历史与范围入口");
  assert.ok(!html.includes("scopebackdrop") && !source("background.js").includes("resizeScope") && !source("bg/windows.js").includes("SCOPE_H"), "主 console 不得再包含或触发拉高逻辑");
  assert.ok(css.includes("#scope-manage{display:grid;grid-template-columns:1fr;") && css.includes("#ch-foot .scope{flex:1 0 100%;") && css.includes("#ch-back{margin-left:auto}"), "范围管理与编辑窗操作应在真实窗口宽度下保持完整稳定");
  assert.ok(css.includes("--ease-out:cubic-bezier(0.23,1,0.32,1)") && css.includes("button:active:not(:disabled)") && css.includes("@media (prefers-reduced-motion:reduce)"), "console 系界面应统一指针反馈并支持 reduced-motion");
  for (const id of ["tile", "collect"]) {
    const button = html.match(new RegExp(`<button id="${id}"[\\s\\S]*?</button>`))[0];
    assert.ok(button.includes('class="icon"') && button.includes("<svg") && !button.includes("<span"), `${id} 应为带无障碍说明的纯 SVG 图标按钮`);
  }
}

function testCompanionResponsibilities() {
  const compose = source("console/compose.html");
  assert.ok(!compose.includes("<select") && compose.includes('id="cmp-tab-templates"') && compose.includes('id="cmp-tab-history"'), "编辑窗应使用自定义模板/历史列表");
  assert.ok(compose.includes('id="cmp-save-template"') && compose.includes('id="cmp-delete-template"'), "模板管理应归入编辑窗");

  const scope = source("console/scope.html");
  assert.ok(scope.includes('id="scope-checkup"') && scope.includes('id="scope-live"'), "范围窗应接管站点巡检及状态播报");

  const archive = source("console/archive.html");
  assert.ok(!archive.includes("<select") && archive.includes('id="ar-list"') && archive.includes('role="listbox"'), "归档应使用自定义可访问列表");
  for (const id of ["ar-capture", "ar-copy", "ar-export", "ar-del"]) assert.ok(archive.includes(`id="${id}"`), `归档窗应提供 ${id}`);
}

function testScopeControls() {
  const js = source("console/scope.js");
  const start = js.indexOf("// SCOPE_LOGIC_START");
  const end = js.indexOf("// SCOPE_LOGIC_END") + "// SCOPE_LOGIC_END".length;
  assert.ok(start >= 0 && end > start, "应找到范围选择逻辑");
  const selected = { a: true, b: false, c: false };
  let saves = 0, renders = 0;
  const context = vm.createContext({
    ALL_HOSTS: ["a", "b", "c"], selected, groups: [{ name: "A", hosts: ["a"] }],
    persistSelection: () => { saves++; }, renderScope: () => { renders++; },
  });
  vm.runInContext(js.slice(start, end), context);
  assert.equal(context.canSaveGroup([]), false, "空选择不能保存为分组");
  assert.equal(context.canSaveGroup(["a"]), false, "与已有分组重复的选择不能保存");
  assert.equal(context.canSaveGroup(["c", "b", "a"]), false, "全部站点不能重复保存为分组");
  assert.equal(context.canSaveGroup(["b"]), true, "新选择可以保存为分组");
  assert.equal(context.setSiteSelected("b", true), true, "已知站点应可连续切换");
  assert.equal(selected.b, true); assert.equal(saves, 1); assert.equal(renders, 1);
  assert.equal(context.setSiteSelected("missing", true), false, "未知站点不得写入选择");
  assert.equal(saves, 1);
  const panels = source("bg/panels.js");
  assert.ok(panels.includes('getURL("console/scope.html")') && panels.includes('type: "popup"'), "范围选择应使用独立 popup");
}

function testConsoleShortcuts() {
  const js = source("console/console.js");
  const start = js.indexOf('document.addEventListener("keydown", (e) => {', js.indexOf('action: "newSession"'));
  const end = js.indexOf("\n});", start) + 4;
  assert.ok(start >= 0 && end > start, "应找到控制台快捷键处理器");

  const actions = [];
  const elements = Object.fromEntries(["collect", "tile", "newsession", "prompt", "retry"].map((id) => [id, {
    click: () => actions.push(id), focus: () => actions.push(id),
  }]));
  let handler;
  const document = {
    addEventListener: (type, fn) => { if (type === "keydown") handler = fn; },
    getElementById: (id) => elements[id],
  };
  vm.runInNewContext(js.slice(start, end), { document, elPrompt: elements.prompt });

  const press = (code, extra = {}) => {
    const event = { code, altKey: true, ctrlKey: false, metaKey: false, shiftKey: false, repeat: false, isComposing: false,
      preventDefault() { this.defaultPrevented = true; }, ...extra };
    actions.length = 0; handler(event); return { event, actions: [...actions] };
  };
  Object.entries({ KeyC: "collect", KeyL: "tile", KeyN: "newsession", KeyP: "prompt", KeyR: "retry" }).forEach(([code, id]) => {
    const result = press(code);
    assert.equal(result.event.defaultPrevented, true, `${code} 应阻止浏览器默认行为`);
    assert.deepEqual(result.actions, [id], `${code} 应触发 ${id}`);
  });
  [{ altKey: false }, { ctrlKey: true }, { shiftKey: true }, { repeat: true }, { isComposing: true }].forEach((extra) => {
    const result = press("KeyC", extra);
    assert.equal(result.event.defaultPrevented, undefined, "非精确 Alt 组合不得被接管");
    assert.deepEqual(result.actions, [], "非精确 Alt 组合不得触发操作");
  });
}

async function testManagedWindows() {
  const records = {
    "chatgpt.com": { id: 1, owned: true },
    "claude.ai": { id: 2, owned: true },
    "gemini.google.com": { id: 3, owned: true },
  };
  const windows = new Map([
    [1, { id: 1, type: "popup" }],
    [2, { id: 2, type: "normal" }],
    [3, { id: 3, type: "popup" }],
    [4, { id: 4, type: "popup" }],
  ]);
  const tabs = new Map([
    [1, [{ id: 11, windowId: 1, active: true, url: "https://chatgpt.com/" }]],
    [2, [{ id: 21, windowId: 2, active: true, url: "https://claude.ai/new" }]],
    [3, [
      { id: 31, windowId: 3, active: true, url: "https://example.com/" },
      { id: 32, windowId: 3, active: false, url: "https://gemini.google.com/app" },
    ]],
    [4, [{ id: 41, windowId: 4, active: true, url: "https://www.kimi.com/" }]],
  ]);
  const chrome = {
    runtime: { lastError: null },
    storage: {
      session: {
        get: (_key, cb) => cb({ amsWindows: records }),
        set: (_value, cb) => cb(),
      },
    },
    windows: {
      get: async (id) => windows.get(id) || Promise.reject(new Error("missing")),
      update: async (id, props) => Object.assign(windows.get(id), props),
    },
    tabs: { query: async ({ active, windowId }) => (tabs.get(windowId) || []).filter((tab) => !active || tab.active) },
  };
  const context = vm.createContext({ chrome, URL, console, consoleWinId: 1, composeWinId: null, archiveWinId: null });
  vm.runInContext(source("bg/windows.js"), context);
  const resolve = (host) => vm.runInContext(`popupWindowForHost(${JSON.stringify(host)}, ${JSON.stringify(records)})`, context);

  assert.equal(await resolve("chatgpt.com"), 1, "应解析登记且活动标签匹配的 popup");
  assert.equal(await resolve("claude.ai"), null, "登记为 normal 的窗口必须拒绝");
  assert.equal(await resolve("gemini.google.com"), null, "仅后台标签匹配时必须拒绝");
  assert.equal(await resolve("www.kimi.com"), null, "未登记的第三方 popup 不得被全局收编");
}

async function testSubmitIsAtMostOnce() {
  let calls = 0;
  let throwAfterDispatch = true;
  const chrome = {
    runtime: { lastError: null, sendMessage: (_msg, cb) => cb() },
    tabs: {
      sendMessage: async (_id, msg) => {
        calls++;
        if (msg.cmd === "getState") return { state: "fast" };
        if (throwAfterDispatch) throw new Error("message port closed after dispatch");
        return undefined;
      },
    },
  };
  const context = vm.createContext({
    chrome, URL, console, setTimeout, clearTimeout,
    getWindows: async () => ({}),
    tabsForHost: async () => [{ id: 9 }],
  });
  vm.runInContext(source("bg/broadcast.js"), context);

  const result = await vm.runInContext(
    'submitWhenReady({host:"chatgpt.com"}, "probe", null, 100, 1, currentSendEpoch())', context
  );
  assert.equal(result.code, "submit_unconfirmed");
  assert.equal(calls, 2, "只允许一次就绪探测和一次正式提交，不得重发");

  throwAfterDispatch = false;
  const malformed = await vm.runInContext(
    'submitWhenReady({host:"chatgpt.com"}, "probe", null, 100, 1, currentSendEpoch())', context
  );
  assert.equal(malformed.code, "submit_unconfirmed");
  assert.equal(calls, 4, "空响应也不得触发第二次正式提交");

  vm.runInContext("cancelPendingSends()", context);
  const cancelled = await vm.runInContext(
    'submitWhenReady({host:"chatgpt.com"}, "probe", null, 100, 1, 0)', context
  );
  assert.equal(cancelled.code, "cancelled");
  assert.equal(calls, 4, "取消后的发送不得触碰标签页");
}

async function testHungMessageHonorsDeadline() {
  const chrome = {
    runtime: { lastError: null, sendMessage: (_msg, cb) => cb() },
    tabs: { sendMessage: () => new Promise(() => {}) },
  };
  const context = vm.createContext({
    chrome, URL, console, setTimeout, clearTimeout,
    getWindows: async () => ({}),
    tabsForHost: async () => [{ id: 9 }],
  });
  vm.runInContext(source("bg/broadcast.js"), context);
  const started = Date.now();
  const result = await vm.runInContext(
    'submitWhenReady({host:"chatglm.cn"}, "probe", null, 10, 1, currentSendEpoch())', context
  );
  assert.equal(result.code, "timeout");
  assert.ok(Date.now() - started < 250, "悬挂消息必须在绝对截止线附近返回");
}

async function testHungCheckupReleasesOperationQueue() {
  let hangs = true;
  const chrome = {
    runtime: { lastError: null, sendMessage: (_msg, cb) => cb() },
    tabs: { sendMessage: () => hangs ? new Promise(() => {}) : undefined },
  };
  const context = vm.createContext({
    chrome, URL, console, setTimeout, clearTimeout,
    getWindows: async () => ({}),
    tabsForHost: async () => [{ id: 9 }],
  });
  vm.runInContext(source("bg/broadcast.js"), context);
  const started = Date.now();
  vm.runInContext('serializeOp(() => checkupAll([{host:"chatglm.cn"}], 10))', context);
  const next = await vm.runInContext('serializeOp(() => "released")', context);
  assert.equal(next, "released");
  assert.ok(Date.now() - started < 250, "巡检悬挂不得永久占住操作队列");
  hangs = false;
  const malformed = await vm.runInContext('checkupAll([{host:"chatglm.cn"}], 10)', context);
  assert.equal(malformed[0].code, "not_ready", "空诊断响应不得误报巡检通过");
}

(async () => {
  testPopupLayout();
  testConsoleControls();
  testCompanionResponsibilities();
  testScopeControls();
  testConsoleShortcuts();
  await testManagedWindows();
  await testSubmitIsAtMostOnce();
  await testHungMessageHonorsDeadline();
  await testHungCheckupReleasesOperationQueue();
  console.log("[regression] 安全边界与控制台控件通过");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
