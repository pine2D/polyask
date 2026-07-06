// bg/broadcast.js — 广播层：群发、平铺开窗、新会话（依赖 bg/windows.js 的窗口层）

// 把 openTile/sendAll 串行化，杜绝并发各自读-改-写 amsWindows 泄漏同 host 重复 popup
let _opChain = Promise.resolve();
function serializeOp(fn) { const r = _opChain.then(fn, fn); _opChain = r.then(() => {}, () => {}); return r; }

// prune=false（sendAll 隐式开窗）：只为缺窗站开窗落格，不关未勾选站、不重排已有窗口的
// 用户手调布局（追问少数站时不得动别人正摆着答案的窗）；显式「平铺」按钮保持全量重排语义。
async function openTile(sites, prune = true) {
  const wa = await consoleWorkArea(); // console 拖到哪个显示器就铺哪个显示器

  const reserve = await consoleReserveHeight(wa);
  const areaLeft = wa.left, areaTop = wa.top + reserve, areaW = wa.width;
  const areaH = Math.max(120, wa.height - reserve); // 夹下界：console 被拖低/小屏时 reserve≈全高 → 防负高度建窗
  const n = sites.length || 1;
  // n≤4：单排等分并排（水平二/三/四等分，各占满高度）；n≥5：方形网格
  let cols, rows;
  if (n <= 4) { cols = n; rows = 1; }
  else { cols = Math.ceil(Math.sqrt(n)); rows = Math.ceil(n / cols); }
  const cellW = Math.floor(areaW / cols), cellH = Math.floor(areaH / rows);
  const wins = await getWindows();
  const selectedHosts = sites.map((s) => s.host);
  // 1) 处理已取消勾选（仅显式平铺）：owned 的真正关闭，复用的仅解除登记（用户窗口不动）
  if (prune) for (const host of Object.keys(wins)) {
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
      if (prune) { try { await chrome.windows.update(windowId, Object.assign({ state: "normal", focused: false }, bounds)); } catch (e) {} } // 隐式开窗不重排既有窗
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
  if (tile && anyMissing) await openTile(sites, false); // 隐式开窗不 prune/不重排；retry 传 tile=false 连开窗也免
  // 进度起点（console/compose 发起都统一）；带 text/tier 让 console 重建 lastSend（compose 发起的失败也能一键重试）
  pushBroadcast({ type: "sendStart", hosts: sites.map((s) => s.host), text, tier });
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
// 故 content 未注入 / composer_not_found 都视为"还没好"继续等，其它 ok=false 才是真失败。
// 失败原因走错误码协议（code），由 console 端按界面语言翻译——bg/content 不产出用户可见文案。
// 任一出口都先 pushSiteResult 让该站圆点立刻变色，再返回参与 Promise.all 汇总。
async function submitWhenReady(s, text, tier, timeoutMs = 22000, gap = 800) {
  const t0 = Date.now();
  const done = (ok, code, reason) => { const res = { host: s.host, ok, code, reason }; pushSiteResult(res); return res; };
  const wins = await getWindows(); // openTile 已在 Promise.all 前定稿登记表，轮询期不变，读一次即可
  for (;;) {
    const tabs = await tabsForHost(s.host, wins);
    if (tabs.length) {
      try {
        const r = await chrome.tabs.sendMessage(tabs[0].id, { source: "AMS", cmd: "submitPrompt", text, tier });
        if (r && r.ok) return done(true, r.code); // ok 时 code 可携带 tier_unconfirmed 警示
        if (r && typeof r.ok === "boolean" && r.code !== "composer_not_found") {
          return done(false, r.code || "error", r.reason);
        }
      } catch (e) { /* content 未注入，页面还在加载 → 继续等 */ }
    }
    if (Date.now() - t0 > timeoutMs) return done(false, "timeout");
    await new Promise((res) => setTimeout(res, gap));
  }
}

// tab 是否已停在该站"新会话入口"（origin+pathname 一致，忽略 query/hash 与尾斜杠）。
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
