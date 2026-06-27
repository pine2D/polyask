// background.js — 快捷键转发：onCommand → 当前活动标签的 content script
chrome.commands.onCommand.addListener(async (command) => {
  if (command === "open-console") {
    const cid = await getConsoleWinId();
    if (cid != null) {
      // 恢复 console 并把整组工作区带到前台（与点击/任务栏触发的前后台联动一致）。
      // 先 arm 抑制窗：un-minimize 自身会触发 onFocusChanged(cid)，否则会与下面的显式 raiseWorkspace 重复抬一次。
      suppressFocusUntil = Date.now() + 600;
      try { await chrome.windows.update(cid, { state: "normal" }); consoleMinimized = false; await raiseWorkspace(); return; } catch (e) {}
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

// —— 广播控制台编排 ——
const STRIP_H = 96;

let consoleWinId = null;     // console 弹窗 id（内存缓存）
let consoleMinimized = false; // 联动去抖：console 当前是否最小化
let suppressFocusUntil = 0;  // 程序化抬窗期间忽略 onFocusChanged（时间窗），防递归
let composeWinId = null;
async function getComposeWinId() {
  if (composeWinId != null) return composeWinId;
  const o = await new Promise((r) => chrome.storage.local.get("amsComposeWin", r));
  composeWinId = (o && o.amsComposeWin) != null ? o.amsComposeWin : null;
  return composeWinId;
}
async function getConsoleWinId() {
  if (consoleWinId != null) return consoleWinId;
  const o = await new Promise((r) => chrome.storage.local.get("amsConsoleWin", r));
  consoleWinId = (o && o.amsConsoleWin) != null ? o.amsConsoleWin : null;
  return consoleWinId;
}

async function primaryWorkArea() {
  let wa = { left: 0, top: 0, width: 1280, height: 800 };
  try {
    const info = await chrome.system.display.getInfo();
    const d = info.find((x) => x.isPrimary) || info[0];
    if (d && d.workArea) wa = d.workArea;
  } catch (e) {}
  return wa;
}

// 平铺需保留的顶部高度 = 控制台窗口的「实际底边」相对工作区顶。
// 关键：c.top 已含窗口管理器在 Chrome 几何之外的上移装饰（如 X410 windowed 模式给每个
// 窗口套的 ~30px 标题栏——请求 top=0 时 Chrome 会报告 top=30）。故必须用 (c.top+c.height)
// -wa.top 才是真实占高；只用 c.height 会漏掉这段上移，导致平铺窗口压在控制台上。
// 取不到登记窗口时回退 STRIP_H（原生 Windows/macOS 无此上移，结果即 96）。
async function consoleReserveHeight(wa) {
  const cid = await getConsoleWinId();
  if (cid != null) {
    try {
      const c = await chrome.windows.get(cid);
      if (c && c.top != null && c.height != null) return Math.max(STRIP_H, (c.top + c.height) - wa.top);
    } catch (e) {}
  }
  return STRIP_H;
}

async function openConsole() {
  const wa = await primaryWorkArea();
  const w = await chrome.windows.create({
    url: chrome.runtime.getURL("console/console.html"),
    type: "popup", left: wa.left, top: wa.top, width: wa.width, height: STRIP_H, focused: true,
  });
  consoleWinId = w.id;
  await chrome.storage.local.set({ amsConsoleWin: w.id });
}

// 伴侣窗：控制面（同 console），绝不进 amsWindows、不被平铺/closeAll/联动触碰。
async function openCompose() {
  const cid = await getComposeWinId();
  if (cid != null) { try { await chrome.windows.update(cid, { focused: true, state: "normal" }); return; } catch (e) {} }
  const wa = await primaryWorkArea();
  const W = 560, H = 380;
  const left = wa.left + Math.max(0, Math.floor((wa.width - W) / 2));
  const top = wa.top + Math.max(0, Math.floor((wa.height - H) / 3));
  const w = await chrome.windows.create({ url: chrome.runtime.getURL("console/compose.html"), type: "popup", left, top, width: W, height: H, focused: true });
  composeWinId = w.id;
  await chrome.storage.local.set({ amsComposeWin: w.id });
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
// 解析某 host 的「PolyAsk 受管 popup 窗口」。铁律：只返回 type:"popup"，绝不返回用户
// 日常浏览窗口(type:"normal")。①登记窗口若仍在且是 popup → 用它；②否则全局找一个含该
// host 的 popup（自愈被污染/丢失的登记）；③都没有 → null（调用方新建或对该站静默跳过）。
async function popupWindowForHost(host, wins) {
  const rec = wins && wins[host];
  if (rec && rec.id != null) {
    try { const w = await chrome.windows.get(rec.id); if (w.type === "popup") return rec.id; } catch (e) {}
  }
  try {
    const tabs = await chrome.tabs.query({ url: "*://" + host + "/*" });
    for (const t of tabs) {
      try { const w = await chrome.windows.get(t.windowId); if (w.type === "popup") return t.windowId; } catch (e) {}
    }
  } catch (e) {}
  return null;
}
// 仅当给定窗口 id 确实存在且是 popup 时才关闭它（不回退搜索，避免误关无关窗口）。
async function removeIfPopup(id) {
  try { const w = await chrome.windows.get(id); if (w.type === "popup") await chrome.windows.remove(id); } catch (e) {}
}
// host → 受管 popup 内的标签（只认 popup；无受管窗口则空，调用方对该站静默跳过）。
async function tabsForHost(host, wins) {
  const id = await popupWindowForHost(host, wins);
  if (id == null) return [];
  try { return await chrome.tabs.query({ url: "*://" + host + "/*", windowId: id }); } catch (e) { return []; }
}
async function getAutoRaise() {
  const o = await new Promise((r) => chrome.storage.local.get({ amsAutoRaise: true }, r));
  return o.amsAutoRaise !== false;
}
// 把控制台细条窗口抬到最前（每次平铺/操作后保持可见）
async function raiseConsole() {
  suppressFocusUntil = Date.now() + 600; // 程序化抬 console 会触发 onFocusChanged，抑制其自激
  try {
    const ct = await chrome.tabs.query({ url: chrome.runtime.getURL("console/console.html") });
    if (ct[0]) await chrome.windows.update(ct[0].windowId, { focused: true });
  } catch (e) {}
}

async function openTile(sites) {
  const wa = await primaryWorkArea();
  const reserve = await consoleReserveHeight(wa);
  const areaLeft = wa.left, areaTop = wa.top + reserve, areaW = wa.width, areaH = wa.height - reserve;
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
      if (wins[host].owned) { await removeIfPopup(wins[host].id); }
      delete wins[host];
    }
  }
  // 2) 处理选中站点：优先复用受管 popup → 新建 popup，逐个定位（popup-only 铁律）
  const out = [];
  for (let i = 0; i < sites.length; i++) {
    const s = sites[i];
    const col = i % cols, row = Math.floor(i / cols);
    const bounds = { left: areaLeft + col * cellW, top: areaTop + row * cellH, width: cellW, height: cellH };
    let windowId = await popupWindowForHost(s.host, wins);
    let reused = false, owned = false;
    if (windowId != null) {
      reused = true;
      const rec = wins[s.host];
      owned = !!(rec && rec.id === windowId && rec.owned); // 仅沿用「同一登记窗口」的归属
      try { await chrome.windows.update(windowId, Object.assign({ state: "normal", focused: false }, bounds)); } catch (e) {}
    } else {
      try { const w = await chrome.windows.create(Object.assign({ url: s.url, type: "popup", focused: false }, bounds)); windowId = w.id; owned = true; } catch (e) {}
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

// 发送到全部：有站点尚无窗口则先平铺，再逐站等页面就绪后提交。
// 用户初次使用无需先点「平铺」：勾选 → 输入 → Enter 即可一步开窗+群发。
async function sendAll(sites, text, tier, tile = true) {
  const wins = await getWindows();
  let anyMissing = false;
  for (const s of sites) { if ((await popupWindowForHost(s.host, wins)) == null) { anyMissing = true; break; } }
  if (tile && anyMissing) await openTile(sites); // retry 传 tile=false：只复发不重铺，避免 prune 误关成功兄弟窗
  pushBroadcast({ type: "sendStart", hosts: sites.map((s) => s.host) }); // 进度起点（console/compose 发起都统一）
  const results = await Promise.all(sites.map((s) => submitWhenReady(s, text, tier)));
  if (await getAutoRaise()) await focusAll(sites); // 发送后自动置顶全部平铺窗
  await raiseConsole();
  return results;
}

// 单站结果即时推给控制台（逐站实时回填，无需等全部完成）；无接收方时静默吞错。
function pushBroadcast(payload) {
  try { chrome.runtime.sendMessage(Object.assign({ from: "AMS_BG" }, payload), () => void chrome.runtime.lastError); } catch (e) {}
}
function pushSiteResult(res) { pushBroadcast({ type: "siteResult", result: res }); }

// 轮询直到该站页面就绪并提交：已开窗口首轮即命中；新开窗口需加载+content 注入+composer 出现，
// 故 content 未注入 / 「输入框未找到」都视为"还没好"继续等，其它 ok=false 才是真失败。
// 任一出口都先 pushSiteResult 让该站圆点立刻变色，再返回参与 Promise.all 汇总。
async function submitWhenReady(s, text, tier, timeoutMs = 22000, gap = 800) {
  const t0 = Date.now();
  const done = (ok, reason) => { const res = { host: s.host, ok, reason }; pushSiteResult(res); return res; };
  for (;;) {
    const wins = await getWindows();
    const tabs = await tabsForHost(s.host, wins);
    if (tabs.length) {
      try {
        const r = await chrome.tabs.sendMessage(tabs[0].id, { source: "AMS", cmd: "submitPrompt", text, tier });
        if (r && r.ok) return done(true, r.reason);
        if (r && typeof r.ok === "boolean" && !/未找到|not found/i.test(r.reason || "")) {
          return done(false, r.reason || "提交失败");
        }
      } catch (e) { /* content 未注入，页面还在加载 → 继续等 */ }
    }
    if (Date.now() - t0 > timeoutMs) return done(false, "超时未就绪");
    await new Promise((res) => setTimeout(res, gap));
  }
}

async function windowIdsForSites(sites) {
  const wins = await getWindows();
  const ids = [];
  for (const s of sites) {
    const id = await popupWindowForHost(s.host, wins);
    if (id != null) ids.push(id);
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
    if (wins[host].owned) { await removeIfPopup(wins[host].id); }
  }
  await setWindows({});
}
// 受管平铺窗 id 列表（经 popup-only 解析，绝不含日常窗口）
async function managedTileIds() {
  const wins = await getWindows();
  const ids = [];
  for (const host of Object.keys(wins)) { const id = await popupWindowForHost(host, wins); if (id != null) ids.push(id); }
  return ids;
}
// 联动：统一最小化全部受管 popup（绝不碰日常窗口）
async function minimizeAllManaged() {
  for (const id of await managedTileIds()) { try { await chrome.windows.update(id, { state: "minimized" }); } catch (e) {} }
}
// ③ 把 PolyAsk 工作区（平铺窗 + console）整体抬到前台：各窗 focused:true 抬 z-order，console 最后置顶。
// ④ 跨平台：state/focused 是 chrome.windows 的可移植操作，三系统通用；但 focused:true 的实际
// 置顶效果受各 OS 窗口管理器左右（尤其 Linux 防焦点抢占可能拦截程序化置顶），只能尽力而为。
async function raiseWorkspace() {
  suppressFocusUntil = Date.now() + 600; // 抑制随后由程序化抬窗触发的 onFocusChanged，防递归
  for (const id of await managedTileIds()) { try { await chrome.windows.update(id, { state: "normal", focused: true }); } catch (e) {} }
  await raiseConsole();
  suppressFocusUntil = Date.now() + 600; // ponytail: 时间窗启发式(600ms)，上限=偶尔误抑制一次紧邻真实切换
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
// ③ 扩展：console 从后方被带到前台（点击窗口 / 点任务栏缩略图 / Alt+A——三者最终都走「console 获焦」）
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
  if (msg.action === "openCompose") { openCompose(); return; }
  if (msg.action === "openTile") { openTile(msg.sites || []).then((results) => sendResponse({ results })); return true; }
  if (msg.action === "sendAll") { sendAll(msg.sites || [], msg.text || "", msg.tier || null, msg.tile !== false).then((results) => sendResponse({ results })); return true; }
  if (msg.action === "focusAll") { focusAll(msg.sites || []); return; }
  if (msg.action === "minimizeAll") { minimizeAll(msg.sites || []); return; }
  if (msg.action === "closeAll") { closeAll(); return; }
  if (msg.action === "newSession") { newSessionAll(msg.sites || []); return; }
});
