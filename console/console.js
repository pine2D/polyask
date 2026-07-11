const elSites = document.getElementById("sites");
const elTier = document.getElementById("tier");
const elPrompt = document.getElementById("prompt");
let selected = {};

// Task 4: 历史状态
let history = [];
let histCursor = -1; // -1 = 未在浏览历史
let histDraft = ""; // 进入历史浏览前的未发送草稿（↓ 回到 -1 时还原）
function pushHistory(text) {
  if (!text) return;
  history = [text, ...history.filter((h) => h !== text)].slice(0, 20);
  chrome.storage.local.set({ amsHistory: history });
  histCursor = -1;
  renderHist();
}

// 历史下拉：↑↓ 仅键盘可达，给鼠标/触屏一个原生 select 入口（96px 细条下唯一安全的下拉形态）
const elHist = document.getElementById("hist");
function renderHist() {
  elHist.replaceChildren();
  const ph = document.createElement("option"); ph.value = ""; ph.textContent = t("con_histPh");
  elHist.appendChild(ph);
  history.forEach((h, i) => {
    const o = document.createElement("option");
    o.value = String(i);
    o.textContent = h.length > 24 ? h.slice(0, 24) + "…" : h;
    elHist.appendChild(o);
  });
}
elHist.addEventListener("change", () => {
  const i = parseInt(elHist.value, 10);
  if (!isNaN(i) && history[i] != null) {
    elPrompt.value = history[i]; histCursor = -1; elPrompt.title = "";
    save(); elPrompt.focus();
  }
  elHist.value = ""; // 回填即成草稿，下拉拨回占位（与 ↑↓ 浏览语义一致，不驻留选中态）
});

// Task 6: 模板状态
let templates = [];
const elTpl = document.getElementById("tpl");
function renderTemplates() {
  elTpl.replaceChildren();
  const ph = document.createElement("option"); ph.value = ""; ph.textContent = t("con_tplPh");
  elTpl.appendChild(ph);
  templates.forEach((t, i) => {
    const o = document.createElement("option");
    o.value = String(i);
    o.textContent = t.name || (t.text.length > 24 ? t.text.slice(0, 24) + "…" : t.text);
    elTpl.appendChild(o);
  });
}

function render() {
  // 快照重建前的运行时状态（send/open/done/fail + 原因 title），重建后恢复——群发中改分组不再抹掉进度
  const prev = {};
  elSites.querySelectorAll(".chip").forEach((c) => { const st = ["send", "open", "done", "fail"].find((x) => c.classList.contains(x)); if (st) prev[c.dataset.host] = { st, title: c.title }; });
  elSites.replaceChildren();
  SITES.forEach((s) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "chip" + (selected[s.host] ? "" : " off");
    chip.dataset.host = s.host;
    chip.dataset.label = s.label;
    chip.title = s.label + " · " + t("con_chipHint"); // 闲时教学、忙时报状态（setDot 会覆盖为原因）
    chip.setAttribute("aria-pressed", selected[s.host] ? "true" : "false");
    chip.setAttribute("aria-label", s.label); // setDot 会随状态更新（读屏拿不到 title）
    const d = document.createElement("span"); d.className = "d";
    chip.append(d, document.createTextNode(s.label));
    const p = prev[s.host]; if (p) { chip.classList.add(p.st); chip.title = p.title; }
    chip.addEventListener("click", () => {
      selected[s.host] = !selected[s.host];
      chip.classList.toggle("off", !selected[s.host]);
      chip.setAttribute("aria-pressed", selected[s.host] ? "true" : "false");
      save();
    });
    elSites.appendChild(chip);
  });
  updateArrows(); // 芯片数量/宽度变化后重算溢出箭头
}
function chosen() { return SITES.filter((s) => selected[s.host]); }
// 芯片区滚动条已隐藏（挤占 96px 细条布局）：滚轮横滚 + 按住拖动补滚动通道，两侧箭头指示溢出方向
function updateArrows() {
  document.getElementById("sites-l").classList.toggle("on", elSites.scrollLeft > 2);
  document.getElementById("sites-r").classList.toggle("on", elSites.scrollLeft + elSites.clientWidth < elSites.scrollWidth - 2);
}
elSites.addEventListener("scroll", updateArrows, { passive: true });
window.addEventListener("resize", updateArrows);
document.getElementById("sites-l").addEventListener("click", () => elSites.scrollBy({ left: -120, behavior: "smooth" }));
document.getElementById("sites-r").addEventListener("click", () => elSites.scrollBy({ left: 120, behavior: "smooth" }));
elSites.addEventListener("wheel", (e) => {
  if (!e.deltaY || e.deltaX) return; // 触控板横扫走原生
  elSites.scrollLeft += e.deltaY; e.preventDefault();
}, { passive: false });
let dragX = null, dragL = 0, dragged = false; // 按住拖动；4px 阈值内视为点选、不进入拖动
elSites.addEventListener("pointerdown", (e) => { dragX = e.clientX; dragL = elSites.scrollLeft; dragged = false; });
elSites.addEventListener("pointermove", (e) => {
  if (dragX == null) return;
  if (!dragged && Math.abs(e.clientX - dragX) > 4) { dragged = true; elSites.setPointerCapture(e.pointerId); }
  if (dragged) elSites.scrollLeft = dragL - (e.clientX - dragX);
});
elSites.addEventListener("pointerup", () => { dragX = null; });
elSites.addEventListener("pointercancel", () => { dragX = null; });
elSites.addEventListener("click", (e) => { if (dragged) { e.stopPropagation(); e.preventDefault(); dragged = false; } }, true); // 拖动收尾的 click 不算点选

// —— 分组（item4）：预设虚拟项 + 自定义 amsGroups ——
let groups = []; // [{name, hosts}]
let selBeforeGroup = null; // 最近一次套用分组前的勾选快照（删除分组流程用于恢复，见 manage.js）
const elGroup = document.getElementById("group");
// 仅保留范围助手「全部 / 清空」；区域分组（国际/国产）已移除——避免对不可删的内置项点 ✕ 无反应
const BUILTINS = [
  { key: "all", tKey: "con_grpAll", hosts: SITES.map((s) => s.host) },
  { key: "none", tKey: "con_grpNone", hosts: [] },
];
function renderGroups() {
  elGroup.replaceChildren();
  const ph = document.createElement("option"); ph.value = ""; ph.textContent = t("con_groupPh"); elGroup.appendChild(ph);
  const og1 = document.createElement("optgroup"); og1.label = t("con_grpSection");
  BUILTINS.forEach((b) => { const o = document.createElement("option"); o.value = "b:" + b.key; o.textContent = t(b.tKey); og1.appendChild(o); });
  elGroup.appendChild(og1);
  if (groups.length) {
    const og2 = document.createElement("optgroup"); og2.label = t("con_grpMine");
    groups.forEach((g, i) => { const o = document.createElement("option"); o.value = "g:" + i; o.textContent = g.name; og2.appendChild(o); });
    elGroup.appendChild(og2);
  }
  syncGroupSelect();
}
function hostsOfValue(v) {
  if (v.startsWith("b:")) { const b = BUILTINS.find((x) => "b:" + x.key === v); return b ? b.hosts : null; }
  if (v.startsWith("g:")) { const g = groups[parseInt(v.slice(2), 10)]; return g ? g.hosts : null; }
  return null;
}
function applyHosts(hosts) {
  SITES.forEach((s) => { selected[s.host] = hosts.includes(s.host); });
  save(); render();
}
// 当前选择精确匹配某分组 → 回显之；否则落到占位（"自定义"）
function matchGroupValue() {
  const cur = SITES.filter((s) => selected[s.host]).map((s) => s.host).sort().join(",");
  for (const b of BUILTINS) { if (b.hosts.slice().sort().join(",") === cur) return "b:" + b.key; }
  for (let i = 0; i < groups.length; i++) { if (groups[i].hosts.slice().sort().join(",") === cur) return "g:" + i; }
  return "";
}
// ✕ 仅在选中「自定义分组(g:)」时可用；选中内置项/占位时置灰（给反馈，不再静默 no-op）
function updateGrpDel() { document.getElementById("grp-del").disabled = !elGroup.value.startsWith("g:"); }
function syncGroupSelect() { elGroup.value = matchGroupValue(); updateGrpDel(); }
elGroup.addEventListener("change", () => {
  const hosts = hostsOfValue(elGroup.value);
  if (hosts) { selBeforeGroup = Object.assign({}, selected); applyHosts(hosts); } else syncGroupSelect();
});
document.getElementById("grp-save").addEventListener("click", () => {
  const hosts = chosen().map((s) => s.host);
  if (!hosts.length) return;
  startName("grp", t("con_grpNamePh"), { hosts });
});
document.getElementById("grp-del").addEventListener("click", () => {
  const v = elGroup.value;
  if (!v.startsWith("g:")) return; // 仅自定义可删
  const i = parseInt(v.slice(2), 10);
  askDelete("grp", i, groups[i].name);
});

// 群发进度/结果状态（setDot/applyResults/errText/progress/lastSend/失败汇总）拆在 console/status.js（本文件之后加载）
function save() {
  chrome.storage.local.set({ amsConsole: { selected, tier: elTier.value, prompt: elPrompt.value } });
  if (typeof syncGroupSelect === "function") syncGroupSelect();
}
function load() {
  // 五个 key 单次 get：冷启动少一轮 storage IPC 往返
  chrome.storage.local.get(["amsConsole", "amsHistory", "amsTemplates", "amsGroups", "amsConsolePrefill"], (o) => {
    const c = (o && o.amsConsole) || {};
    selected = c.selected || {};
    const pre = o && o.amsConsolePrefill; // popup「打开控制台」带来的当前站（一次性消费）
    if (pre) chrome.storage.local.remove("amsConsolePrefill");
    if (!Object.keys(selected).length) {
      // 首次使用（无勾选历史）：从 popup 带站进来就只预勾该站，否则用默认勾选集
      const hit = pre && SITES.find((s) => pre.includes(s.host.replace(/^www\./, "")) || s.host.includes(pre.replace(/^www\./, "")));
      if (hit) selected[hit.host] = true;
      else SITES.forEach((s) => { selected[s.host] = !!s.on; });
    }
    if (c.tier) elTier.value = c.tier;
    if (c.prompt) elPrompt.value = c.prompt;
    history = (o && o.amsHistory) || []; // Task 4: 历史
    renderHist();
    render();
    const raw = (o && o.amsTemplates) || []; // Task 6: 模板
    templates = raw.map((x) => (typeof x === "string" ? { name: "", text: x } : x)); // 旧 string[] 迁移
    renderTemplates();
    groups = (o && o.amsGroups) || [];
    renderGroups();
  });
}
// 排队操作忙碌态：openTile/closeAll/newSession/sendAll 在 bg 走 serializeOp 严格排队，群发中点这些
// 按钮最长要等 ~22s 才真正执行——零反馈像卡死。禁用到回调返回，兜底定时器防回调丢失永久禁用。
function busy(btn, ms) {
  btn.disabled = true;
  const timer = setTimeout(() => { btn.disabled = false; }, ms || 30000);
  return () => { clearTimeout(timer); btn.disabled = false; };
}
document.getElementById("tile").addEventListener("click", (e) => {
  const sites = chosen(); if (!sites.length) return;
  ignoreResults = false; // 用户新动作：解除 closeAll 后的结果忽略态
  const free = busy(e.currentTarget);
  // Task 7: 改用 state "send"
  sites.forEach((s) => setDot(s.host, "send", t("con_winOpening")));
  armDotTimeouts(sites.map((s) => s.host)); // 回调断掉时"开窗中"不永久挂起
  chrome.runtime.sendMessage({ source: "AMS_CONSOLE", action: "openTile", sites }, (resp) => { free(); applyResults(resp && resp.results); });
});
function shake(el) { el.classList.remove("shake"); void el.offsetWidth; el.classList.add("shake"); }
document.getElementById("send").addEventListener("click", () => {
  if (elSend.disabled) return;                       // in-flight 防双发/双 Enter
  const sites = chosen(); if (!sites.length) { shake(elSend); return; }
  const text = elPrompt.value.trim(); if (!text) { shake(elPrompt); return; }
  pushHistory(text);
  lastSend = { text, tier: elTier.value || null };
  elSend.disabled = true;
  const reEnableTimer = setTimeout(() => { elSend.disabled = false; }, 25000); // 兜底复位
  sites.forEach((s) => setDot(s.host, "send", t("con_sendingTile")));
  chrome.runtime.sendMessage({ source: "AMS_CONSOLE", action: "sendAll", sites, text, tier: elTier.value || null }, (resp) => {
    clearTimeout(reEnableTimer); elSend.disabled = false; applyResults(resp && resp.results);
  });
});
document.getElementById("collect").addEventListener("click", () => {
  const sites = chosen(); if (!sites.length) return;
  chrome.runtime.sendMessage({ source: "AMS_CONSOLE", action: "collect", sites }, (resp) => copySummary(sites, (resp && resp.results) || []));
});
document.getElementById("checkup").addEventListener("click", () => {
  const sites = chosen(); if (!sites.length) return;
  ignoreResults = false; // 用户新动作：解除结果忽略态
  sites.forEach((s) => setDot(s.host, "send", t("con_checking")));
  armDotTimeouts(sites.map((s) => s.host));
  chrome.runtime.sendMessage({ source: "AMS_CONSOLE", action: "checkup", sites }, (resp) => applyResults(resp && resp.results));
});
document.getElementById("newsession").addEventListener("click", (e) => {
  const sites = chosen(); if (!sites.length) return;
  const free = busy(e.currentTarget);
  chrome.runtime.sendMessage({ source: "AMS_CONSOLE", action: "newSession", sites }, () => { void chrome.runtime.lastError; free(); });
});
document.getElementById("closeall").addEventListener("click", (e) => {
  const free = busy(e.currentTarget);
  chrome.runtime.sendMessage({ source: "AMS_CONSOLE", action: "closeAll" }, () => { void chrome.runtime.lastError; free(); });
  ignoreResults = true; // 在途群发的迟到结果不得复活刚清空的芯片（下一次 sendStart/tile/checkup 解除）
  [...document.querySelectorAll('.chip')].forEach((c) => { c.classList.remove("send", "open", "done", "fail"); c.title = c.dataset.label + " · " + t("con_chipHint"); c.setAttribute("aria-label", c.dataset.label); });
  progress = { total: 0, done: 0 }; updateSendLabel(); lastSend = null; updateRetry(); updateFailSum();
});
elTier.addEventListener("change", save);
let _promptSaveTimer = null;
elPrompt.addEventListener("input", () => {
  histCursor = -1; elPrompt.title = ""; // 编辑历史条目即成为新草稿，清位置指示
  clearTimeout(_promptSaveTimer);
  _promptSaveTimer = setTimeout(() => { // 防抖：每字一次 storage.set 太贵；prompt 与分组无关，不跑 syncGroupSelect
    chrome.storage.local.get("amsConsole", (o) => {
      const c = Object.assign({}, (o && o.amsConsole) || {}, { prompt: elPrompt.value });
      chrome.storage.local.set({ amsConsole: c });
    });
  }, 200);
});

// Task 6: 模板接线
elTpl.addEventListener("change", () => {
  const i = parseInt(elTpl.value, 10);
  if (!isNaN(i) && templates[i] != null) { elPrompt.value = templates[i].text; save(); elPrompt.focus(); }
});
document.getElementById("tpl-save").addEventListener("click", () => {
  const text = elPrompt.value.trim();
  if (!text || templates.some((t) => t.text === text)) return;
  startName("tpl", t("con_tplNamePh"), { text });
});
document.getElementById("tpl-del").addEventListener("click", () => {
  const i = parseInt(elTpl.value, 10);
  if (isNaN(i)) return;
  const t = templates[i];
  askDelete("tpl", i, t.name || (t.text.length > 12 ? t.text.slice(0, 12) + "…" : t.text));
});

// Task 4: Enter 发送 + ↑↓ 历史
elPrompt.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.isComposing && !e.shiftKey) { // 输入法合成中不误发
    e.preventDefault(); document.getElementById("send").click(); return;
  }
  if (e.key === "ArrowUp" && !e.isComposing && history.length) { // IME 方向键选词不劫持
    e.preventDefault();
    if (histCursor === -1) histDraft = elPrompt.value; // 进浏览前先存草稿，↓ 回来可还原
    histCursor = Math.min(histCursor + 1, history.length - 1);
    elPrompt.value = history[histCursor]; // 浏览期间不落盘：storage 里始终是草稿，误关窗也不丢
    elPrompt.title = t("con_histPos", histCursor + 1, history.length); // 位置指示（悬停可见）
  } else if (e.key === "ArrowDown" && !e.isComposing) {
    if (histCursor === -1) return; // 未在浏览历史 → 不动用户草稿
    e.preventDefault();
    if (histCursor === 0) { histCursor = -1; elPrompt.value = histDraft; elPrompt.title = ""; }
    else { histCursor -= 1; elPrompt.value = history[histCursor]; elPrompt.title = t("con_histPos", histCursor + 1, history.length); }
  }
});

document.getElementById("compose").addEventListener("click", () => {
  // 上报输入框的视口内位置/宽度，让伴侣窗贴着它展开（制造"输入框展开"的错觉）
  const r = elPrompt.getBoundingClientRect();
  chrome.runtime.sendMessage({ source: "AMS_CONSOLE", action: "openCompose", anchor: { left: r.left, width: r.width } });
});
document.getElementById("retry").addEventListener("click", (e) => {
  if (!lastSend) return;
  const sel = new Set(chosen().map((s) => s.host));   // 只重发"仍勾选且失败"的站
  const failHosts = [...document.querySelectorAll(".chip.fail")].map((c) => c.dataset.host).filter((h) => sel.has(h));
  const sites = SITES.filter((s) => failHosts.includes(s.host));
  if (!sites.length) return;
  const free = busy(e.currentTarget);
  chrome.runtime.sendMessage({ source: "AMS_CONSOLE", action: "sendAll", sites, text: lastSend.text, tier: lastSend.tier, tile: false }, (resp) => { free(); applyResults(resp && resp.results); });
});

// 伴侣窗编辑 → 经 storage 回填细条输入框（本框未编辑时才更新，防回环）
chrome.storage.onChanged.addListener((ch, area) => {
  if (area !== "local") return;
  if (ch.amsHistory) { history = ch.amsHistory.newValue || []; renderHist(); }
  if (!ch.amsConsole) return;
  const p = (ch.amsConsole.newValue || {}).prompt;
  // "编辑中"须同时窗口持焦：窗口失焦后 activeElement 不重置，单看它会永久挡住回填
  if (p != null && p !== elPrompt.value && !(document.hasFocus() && document.activeElement === elPrompt)) { elPrompt.value = p; }
});

load();
document.addEventListener("i18n:changed", () => { renderGroups(); renderTemplates(); renderHist(); updateSendLabel(); });
applyI18n();

// 可靠抬窗触发：chrome.windows.onFocusChanged 在部分 Windows 环境下不触发、也不唤醒休眠的 SW（实测
// 「从非 Chrome 窗口点回 console，平铺窗不跟随」即此因——该事件压根没派发）。改用 console 页面自身的
// DOM focus 事件：只要 console 窗口被点到前台，渲染进程必触发，且 sendMessage 必唤醒 SW，比 onFocusChanged 可靠。
window.addEventListener("focus", () => {
  chrome.runtime.sendMessage({ source: "AMS_CONSOLE", action: "consoleFocused" }, () => void chrome.runtime.lastError);
});
// 最小化联动同样改用可靠页面事件：console 窗口被最小化 → document.hidden=true → 通知后台联动最小化
// 平铺窗（后台再校验 window state 区分「最小化 vs 被完全遮挡」）。还原/抬前由上面的 focus 监听覆盖。
document.addEventListener("visibilitychange", () => {
  if (document.hidden) chrome.runtime.sendMessage({ source: "AMS_CONSOLE", action: "consoleHidden" }, () => void chrome.runtime.lastError);
});
