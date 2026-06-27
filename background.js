// background.js — 快捷键转发：onCommand → 当前活动标签的 content script

// —— 广播控制台编排：共享可变状态（bg/windows.js 与 bg/broadcast.js 通过全局访问）——
let consoleWinId = null;     // console 弹窗 id（内存缓存）
let consoleMinimized = false; // 联动去抖：console 当前是否最小化
let suppressFocusUntil = 0;  // 程序化抬窗期间忽略 onFocusChanged（时间窗），防递归
let composeWinId = null;

importScripts("bg/windows.js", "bg/broadcast.js");

chrome.commands.onCommand.addListener(async (command) => {
  if (command === "open-console") {
    const cid = await getConsoleWinId();
    if (cid != null) {
      // 恢复 console 并把整组工作区带到前台（与点击/任务栏触发的前后台联动一致）。
      // 先 arm 抑制窗：un-minimize 自身会触发 onFocusChanged(cid)，否则会与下面的显式 raiseWorkspace 重复抬一次。
      suppressFocusUntil = Date.now() + 600;
      // 类型校验：陈旧 id 跨重启可能撞 type:"normal" 日常窗口 → updateIfPopup 返 false 则落到 openConsole
      if (await updateIfPopup(cid, { state: "normal" })) { consoleMinimized = false; await raiseWorkspace(); return; }
    }
    await openConsole();
    return;
  }
  const mode = command === "switch-think" ? "think" : command === "switch-fast" ? "fast" : null;
  if (!mode) return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id) return;
  try {
    await chrome.tabs.sendMessage(tab.id, { source: "AMS", mode });
  } catch (e) {
    // 活动标签不是受支持站点（无 content script）→ 静默忽略
  }
});

// console 关闭 → 关闭 owned 平铺窗口（不动收编的用户窗口）
chrome.windows.onRemoved.addListener(async (winId) => {
  const cid = await getConsoleWinId();
  if (cid != null && winId === cid) {
    consoleWinId = null; consoleMinimized = false;
    await chrome.storage.local.remove("amsConsoleWin");
    await closeAll();
  }
});
// console 最小化/恢复/前后台 → 联动全部受管 popup。MV3 无原生「最小化」事件，借 onFocusChanged
// （会唤醒 SW）读 console 窗口 state 精确判定，区分「最小化」与「失焦/alt-tab」（后者 state 仍 normal）。
// ③ 扩展：console 从后方被带到前台（点击窗口 / 点任务栏缩略图 / Alt+Q——三者最终都走「console 获焦」）
//   也联动整组前置。winId === console 即「console 这次获得了焦点」。
chrome.windows.onFocusChanged.addListener(async (winId) => {
  if (Date.now() < suppressFocusUntil) return; // 忽略程序化抬窗的自激
  const cid = await getConsoleWinId();
  if (cid == null) return;
  let state = null;
  try { state = (await chrome.windows.get(cid)).state; } catch (e) { return; } // 窗口没了交给 onRemoved
  if (state === "minimized") {
    if (!consoleMinimized) { consoleMinimized = true; await minimizeAllManaged(); }
    return;
  }
  if (consoleMinimized) { consoleMinimized = false; await raiseWorkspace(); return; } // 从最小化恢复
  if (winId === cid) { await raiseWorkspace(); }                                       // 从后方被带到前台
});

// 伴侣窗关闭 → 仅清自身登记（绝不触发 closeAll）
chrome.windows.onRemoved.addListener(async (winId) => {
  const cmp = await getComposeWinId();
  if (cmp != null && winId === cmp) { composeWinId = null; await chrome.storage.local.remove("amsComposeWin"); }
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.source !== "AMS_CONSOLE") return;
  if (msg.action === "openConsole") { openConsole(); return; }
  if (msg.action === "openCompose") { openCompose(msg.anchor); return; }
  if (msg.action === "openTile") { serializeOp(() => openTile(msg.sites || [])).then((results) => sendResponse({ results })).catch(() => sendResponse({ results: [] })); return true; }
  if (msg.action === "sendAll") { serializeOp(() => sendAll(msg.sites || [], msg.text || "", msg.tier || null, msg.tile !== false)).then((results) => sendResponse({ results })).catch(() => sendResponse({ results: [] })); return true; }
  if (msg.action === "closeAll") { closeAll(); return; }
  if (msg.action === "newSession") { newSessionAll(msg.sites || []); return; }
});
