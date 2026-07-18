#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = (file) => fs.readFileSync(path.join(__dirname, "..", file), "utf8");

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
    windows: { get: async (id) => windows.get(id) || Promise.reject(new Error("missing")) },
    tabs: { query: async ({ active, windowId }) => (tabs.get(windowId) || []).filter((tab) => !active || tab.active) },
  };
  const context = vm.createContext({ chrome, URL, console });
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
  await testManagedWindows();
  await testSubmitIsAtMostOnce();
  await testHungMessageHonorsDeadline();
  await testHungCheckupReleasesOperationQueue();
  console.log("[background] 安全边界回归通过");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
