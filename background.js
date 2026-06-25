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

// 控制台管理的窗口 host→{id,owned}（持久化，跨 SW 重启）。owned=true 为控制台新建
// （closeAll 可自动关）；owned=false 为复用的用户窗口（不擅自关）。后续所有按 host
// 的操作都认这里登记的 windowId，不再裸查 tabs——否则会误抓用户事后在主窗口开的同站标签。
function getWindows() {
  return new Promise((res) => chrome.storage.local.get("amsWindows", (o) => res((o && o.amsWindows) || {})));
}
function setWindows(map) {
  return new Promise((res) => chrome.storage.local.set({ amsWindows: map }, () => res()));
}
async function windowExists(id) {
  try { await chrome.windows.get(id); return true; } catch (e) { return false; }
}
// 解析 host 的标签：优先登记窗口内的（绑定），无登记/无命中再退回全局查询。
async function tabsForHost(host, wins) {
  const id = wins && wins[host] && wins[host].id;
  if (id != null) {
    try { const t = await chrome.tabs.query({ url: "*://" + host + "/*", windowId: id }); if (t.length) return t; } catch (e) {}
  }
  try { return await chrome.tabs.query({ url: "*://" + host + "/*" }); } catch (e) { return []; }
}
// 把控制台细条窗口抬到最前（每次平铺/操作后保持可见）
async function raiseConsole() {
  try {
    const ct = await chrome.tabs.query({ url: chrome.runtime.getURL("console/console.html") });
    if (ct[0]) await chrome.windows.update(ct[0].windowId, { focused: true });
  } catch (e) {}
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
  const wins = await getWindows();
  const selectedHosts = sites.map((s) => s.host);
  // 1) 处理已取消勾选：owned 的真正关闭，复用的仅解除登记（用户窗口不动）
  for (const host of Object.keys(wins)) {
    if (!selectedHosts.includes(host)) {
      if (wins[host].owned) { try { await chrome.windows.remove(wins[host].id); } catch (e) {} }
      delete wins[host];
    }
  }
  // 2) 处理选中站点：优先复用上次绑定窗口 → 复用现有同站窗口 → 新建 popup，逐个定位
  const out = [];
  for (let i = 0; i < sites.length; i++) {
    const s = sites[i];
    const col = i % cols, row = Math.floor(i / cols);
    const bounds = { left: areaLeft + col * cellW, top: areaTop + row * cellH, width: cellW, height: cellH };
    let windowId = null, reused = false, owned = false;
    const rec = wins[s.host];
    if (rec && await windowExists(rec.id)) {
      // 上次绑定的窗口仍在：直接复用，不再裸查 tabs（杜绝误抓主窗口同站标签）
      windowId = rec.id; owned = rec.owned; reused = true;
      try { await chrome.windows.update(windowId, Object.assign({ state: "normal", focused: false }, bounds)); } catch (e) {}
    } else {
      let tabs = [];
      try { tabs = await chrome.tabs.query({ url: "*://" + s.host + "/*" }); } catch (e) {}
      if (tabs.length) {
        windowId = tabs[0].windowId; reused = true; owned = false;
        try { await chrome.windows.update(windowId, Object.assign({ state: "normal", focused: false }, bounds)); } catch (e) {}
      } else {
        try { const w = await chrome.windows.create(Object.assign({ url: s.url, type: "popup", focused: false }, bounds)); windowId = w.id; owned = true; } catch (e) {}
      }
    }
    if (windowId != null) wins[s.host] = { id: windowId, owned };
    out.push({ host: s.host, windowId, reused, opened: !reused && windowId != null });
  }
  await setWindows(wins);
  // 3) 抬前所有平铺窗口，最后抬控制台（控制台置顶）→ 无论增删全部可见
  for (const r of out) if (r.windowId != null) { try { await chrome.windows.update(r.windowId, { state: "normal", focused: true }); } catch (e) {} }
  await raiseConsole();
  return out;
}

async function broadcast(sites, text, tier) {
  const wins = await getWindows();
  const results = [];
  for (const s of sites) {
    const tabs = await tabsForHost(s.host, wins);
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
  const wins = await getWindows();
  const ids = [];
  for (const s of sites) {
    const rec = wins[s.host];
    if (rec && rec.id != null) { ids.push(rec.id); continue; }
    const tabs = await tabsForHost(s.host, wins);
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
// 关闭全部：仅关闭控制台新建（owned）的窗口（复用/用户窗口不动），并清空登记
async function closeAll() {
  const wins = await getWindows();
  for (const host of Object.keys(wins)) {
    if (wins[host].owned) { try { await chrome.windows.remove(wins[host].id); } catch (e) {} }
  }
  await setWindows({});
}
// tab 是否已停在该站“新会话入口”（origin+pathname 一致，忽略 query/hash 与尾斜杠）。
// 这 9 站的会话 id 都落在 path（/new→/chat/x、/→/c/x、/app→/app/x），故 path 一致≈空白新会话。
function isNewSessionUrl(tabUrl, newUrl) {
  try {
    const a = new URL(tabUrl), b = new URL(newUrl);
    if (a.origin !== b.origin) return false;
    const norm = (p) => p.replace(/\/+$/, "") || "/";
    return norm(a.pathname) === norm(b.pathname);
  } catch (e) { return false; }
}
// 全部新会话：把每个站点绑定窗口的 tab 导航到该站新会话 URL（无需各站适配新建按钮）；
// 已在新会话入口的窗口跳过重载（省闪烁，并保留用户未发送的输入）。
async function newSessionAll(sites) {
  const wins = await getWindows();
  for (const s of sites) {
    if (!s.url) continue;
    const tabs = await tabsForHost(s.host, wins);
    if (!tabs.length) continue;
    const tab = tabs[0];
    if (tab.url && isNewSessionUrl(tab.url, s.url)) continue;
    try { await chrome.tabs.update(tab.id, { url: s.url }); } catch (e) {}
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.source !== "AMS_CONSOLE") return;
  if (msg.action === "openConsole") { openConsole(); return; }
  if (msg.action === "openTile") { openTile(msg.sites || []).then((results) => sendResponse({ results })); return true; }
  if (msg.action === "broadcast") { broadcast(msg.sites || [], msg.text || "", msg.tier || null).then((results) => sendResponse({ results })); return true; }
  if (msg.action === "focusAll") { focusAll(msg.sites || []); return; }
  if (msg.action === "minimizeAll") { minimizeAll(msg.sites || []); return; }
  if (msg.action === "closeAll") { closeAll(); return; }
  if (msg.action === "newSession") { newSessionAll(msg.sites || []); return; }
});
