// background.js — 快捷键转发：onCommand → 当前活动标签的 content script
chrome.commands.onCommand.addListener(async (command) => {
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

// —— 广播控制台编排 ——
const STRIP_H = 96;

async function primaryWorkArea() {
  let wa = { left: 0, top: 0, width: 1280, height: 800 };
  try {
    const info = await chrome.system.display.getInfo();
    const d = info.find((x) => x.isPrimary) || info[0];
    if (d && d.workArea) wa = d.workArea;
  } catch (e) {}
  return wa;
}

async function openConsole() {
  const wa = await primaryWorkArea();
  await chrome.windows.create({
    url: chrome.runtime.getURL("console/console.html"),
    type: "popup", left: wa.left, top: wa.top, width: wa.width, height: STRIP_H, focused: true,
  });
}

async function openTile(sites) {
  const wa = await primaryWorkArea();
  const areaLeft = wa.left, areaTop = wa.top + STRIP_H, areaW = wa.width, areaH = wa.height - STRIP_H;
  const n = sites.length || 1;
  // n≤4：单排等分并排（水平二/三/四等分，各占满高度）；n≥5：方形网格
  let cols, rows;
  if (n <= 4) { cols = n; rows = 1; }
  else { cols = Math.ceil(Math.sqrt(n)); rows = Math.ceil(n / cols); }
  const cellW = Math.floor(areaW / cols), cellH = Math.floor(areaH / rows);
  const out = [];
  for (let i = 0; i < sites.length; i++) {
    const s = sites[i];
    const col = i % cols, row = Math.floor(i / cols);
    const bounds = { left: areaLeft + col * cellW, top: areaTop + row * cellH, width: cellW, height: cellH };
    let windowId = null, reused = false;
    let tabs = [];
    try { tabs = await chrome.tabs.query({ url: "*://" + s.host + "/*" }); } catch (e) {}
    if (tabs.length) {
      windowId = tabs[0].windowId; reused = true;
      try { await chrome.windows.update(windowId, Object.assign({ state: "normal", focused: false }, bounds)); } catch (e) {}
    } else {
      try { const w = await chrome.windows.create(Object.assign({ url: s.url, type: "popup", focused: false }, bounds)); windowId = w.id; } catch (e) {}
    }
    out.push({ host: s.host, windowId, reused, opened: !reused && windowId != null });
  }
  return out;
}

async function broadcast(sites, text, tier) {
  const results = [];
  for (const s of sites) {
    let tabs = [];
    try { tabs = await chrome.tabs.query({ url: "*://" + s.host + "/*" }); } catch (e) {}
    if (!tabs.length) { results.push({ host: s.host, ok: false, reason: "无窗口" }); continue; }
    try {
      const r = await chrome.tabs.sendMessage(tabs[0].id, { source: "AMS", cmd: "submitPrompt", text, tier });
      if (r && typeof r.ok === "boolean") results.push({ host: s.host, ok: r.ok, reason: r.reason });
      else results.push({ host: s.host, ok: false, reason: "无响应" });
    } catch (e) {
      results.push({ host: s.host, ok: false, reason: "content 未注入" });
    }
  }
  return results;
}

async function windowIdsForSites(sites) {
  const ids = [];
  for (const s of sites) {
    let tabs = [];
    try { tabs = await chrome.tabs.query({ url: "*://" + s.host + "/*" }); } catch (e) {}
    if (tabs.length) ids.push(tabs[0].windowId);
  }
  return ids;
}

// 全部置顶：逐个恢复+抬前（OS 限制：只能一个持焦，平铺不重叠故视觉全前置）
async function focusAll(sites) {
  for (const id of await windowIdsForSites(sites)) {
    try { await chrome.windows.update(id, { state: "normal", focused: true }); } catch (e) {}
  }
}
async function minimizeAll(sites) {
  for (const id of await windowIdsForSites(sites)) {
    try { await chrome.windows.update(id, { state: "minimized" }); } catch (e) {}
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.source !== "AMS_CONSOLE") return;
  if (msg.action === "openConsole") { openConsole(); return; }
  if (msg.action === "openTile") { openTile(msg.sites || []).then((results) => sendResponse({ results })); return true; }
  if (msg.action === "broadcast") { broadcast(msg.sites || [], msg.text || "", msg.tier || null).then((results) => sendResponse({ results })); return true; }
  if (msg.action === "focusAll") { focusAll(msg.sites || []); return; }
  if (msg.action === "minimizeAll") { minimizeAll(msg.sites || []); return; }
});
