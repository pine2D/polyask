const elSites = document.getElementById("sites");
const elTier = document.getElementById("tier");
const elPrompt = document.getElementById("prompt");
let selected = {};

// Task 4: 历史状态
let history = [];
let histCursor = -1; // -1 = 未在浏览历史
function pushHistory(text) {
  if (!text) return;
  history = [text, ...history.filter((h) => h !== text)].slice(0, 20);
  chrome.storage.local.set({ amsHistory: history });
  histCursor = -1;
}

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
  elSites.replaceChildren();
  SITES.forEach((s) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "chip" + (selected[s.host] ? "" : " off");
    chip.dataset.host = s.host;
    chip.dataset.label = s.label;
    chip.title = s.label;
    chip.setAttribute("aria-pressed", selected[s.host] ? "true" : "false");
    const d = document.createElement("span"); d.className = "d";
    chip.append(d, document.createTextNode(s.label));
    chip.addEventListener("click", () => {
      selected[s.host] = !selected[s.host];
      chip.classList.toggle("off", !selected[s.host]);
      chip.setAttribute("aria-pressed", selected[s.host] ? "true" : "false");
      save();
    });
    elSites.appendChild(chip);
  });
}
function chosen() { return SITES.filter((s) => selected[s.host]); }

// —— 分组（item4）：预设虚拟项 + 自定义 amsGroups ——
let groups = []; // [{name, hosts}]
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
  if (hosts) applyHosts(hosts); else syncGroupSelect();
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

// 状态写到芯片：idle 清空 send/done/fail；title 拼「站名 · 原因」（item F 悬停提示）
function setDot(host, state, reason) {
  const chip = document.querySelector('.chip[data-host="' + host + '"]');
  if (!chip) return;
  chip.classList.remove("send", "done", "fail");
  if (state && state !== "idle") chip.classList.add(state);
  chip.title = reason ? chip.dataset.label + " · " + reason : chip.dataset.label;
}

// Task 7: applyResults 改用 state 字符串
function applyResults(results) {
  (results || []).forEach((r) => {
    if (typeof r.ok === "boolean") {
      setDot(r.host, r.ok ? "done" : "fail", r.reason || "");          // sendAll 提交结果
    } else {
      const okWin = r.windowId != null;                                 // openTile 结果
      setDot(r.host, okWin ? "done" : "fail", r.reused ? t("con_reused") : r.opened ? t("con_opened") : t("con_failed"));
    }
  });
}
// 逐站实时回填：sendAll 期间每站一完成，background 即推单站结果，立刻更新该站圆点（不等全部）
let progress = { total: 0, done: 0 };
let lastSend = null; // {text, tier}
const elSend = document.getElementById("send");
function updateSendLabel() {
  elSend.textContent = (progress.total && progress.done < progress.total) ? t("con_sending", progress.done, progress.total) : t("con_sendAll");
}
function updateRetry() {
  const hasFail = !!document.querySelector(".chip.fail");
  document.getElementById("retry").disabled = !(hasFail && lastSend);
}
chrome.runtime.onMessage.addListener((msg) => {
  if (!msg || msg.from !== "AMS_BG") return;
  if (msg.type === "sendStart") {
    progress = { total: msg.hosts.length, done: 0 };
    msg.hosts.forEach((h) => setDot(h, "send", t("con_sendingDot")));
    updateSendLabel(); updateRetry();
  } else if (msg.type === "siteResult" && msg.result) {
    applyResults([msg.result]);
    progress.done++;
    updateSendLabel(); updateRetry();
  }
});
function save() {
  chrome.storage.local.set({ amsConsole: { selected, tier: elTier.value, prompt: elPrompt.value } });
  if (typeof syncGroupSelect === "function") syncGroupSelect();
}
function load() {
  chrome.storage.local.get("amsConsole", (o) => {
    const c = (o && o.amsConsole) || {};
    selected = c.selected || {};
    if (!Object.keys(selected).length) SITES.forEach((s) => { selected[s.host] = !!s.on; });
    if (c.tier) elTier.value = c.tier;
    if (c.prompt) elPrompt.value = c.prompt;
    // Task 4: 加载历史
    chrome.storage.local.get("amsHistory", (h) => { history = (h && h.amsHistory) || []; });
    render();
    // Task 6: 加载模板
    chrome.storage.local.get("amsTemplates", (t) => {
      const raw = (t && t.amsTemplates) || [];
      templates = raw.map((x) => (typeof x === "string" ? { name: "", text: x } : x)); // 旧 string[] 迁移
      renderTemplates();
    });
    chrome.storage.local.get("amsGroups", (g) => { groups = (g && g.amsGroups) || []; renderGroups(); });
  });
}
document.getElementById("tile").addEventListener("click", () => {
  const sites = chosen(); if (!sites.length) return;
  // Task 7: 改用 state "send"
  sites.forEach((s) => setDot(s.host, "send", t("con_winOpening")));
  chrome.runtime.sendMessage({ source: "AMS_CONSOLE", action: "openTile", sites }, (resp) => applyResults(resp && resp.results));
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
document.getElementById("newsession").addEventListener("click", () => {
  const sites = chosen(); if (sites.length) chrome.runtime.sendMessage({ source: "AMS_CONSOLE", action: "newSession", sites });
});
document.getElementById("closeall").addEventListener("click", () => {
  chrome.runtime.sendMessage({ source: "AMS_CONSOLE", action: "closeAll" });
  [...document.querySelectorAll('.chip')].forEach((c) => { c.classList.remove("send", "done", "fail"); c.title = c.dataset.label; });
  progress = { total: 0, done: 0 }; updateSendLabel(); lastSend = null; updateRetry();
});
elTier.addEventListener("change", save);
let _promptSaveTimer = null;
elPrompt.addEventListener("input", () => {
  histCursor = -1;
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
  if (e.key === "ArrowUp" && history.length) {
    e.preventDefault();
    histCursor = Math.min(histCursor + 1, history.length - 1);
    elPrompt.value = history[histCursor]; save();
  } else if (e.key === "ArrowDown") {
    if (histCursor === -1) return; // 未在浏览历史 → 不动用户草稿
    e.preventDefault();
    if (histCursor === 0) { histCursor = -1; elPrompt.value = ""; }
    else { histCursor -= 1; elPrompt.value = history[histCursor]; }
    save();
  }
});

document.getElementById("compose").addEventListener("click", () => {
  // 上报输入框的视口内位置/宽度，让伴侣窗贴着它展开（制造"输入框展开"的错觉）
  const r = elPrompt.getBoundingClientRect();
  chrome.runtime.sendMessage({ source: "AMS_CONSOLE", action: "openCompose", anchor: { left: r.left, width: r.width } });
});
document.getElementById("retry").addEventListener("click", () => {
  if (!lastSend) return;
  const sel = new Set(chosen().map((s) => s.host));   // 只重发"仍勾选且失败"的站
  const failHosts = [...document.querySelectorAll(".chip.fail")].map((c) => c.dataset.host).filter((h) => sel.has(h));
  const sites = SITES.filter((s) => failHosts.includes(s.host));
  if (!sites.length) return;
  chrome.runtime.sendMessage({ source: "AMS_CONSOLE", action: "sendAll", sites, text: lastSend.text, tier: lastSend.tier, tile: false }, (resp) => applyResults(resp && resp.results));
});

// 伴侣窗编辑 → 经 storage 回填细条输入框（本框未编辑时才更新，防回环）
chrome.storage.onChanged.addListener((ch, area) => {
  if (area !== "local") return;
  if (ch.amsHistory) history = ch.amsHistory.newValue || [];
  if (!ch.amsConsole) return;
  const p = (ch.amsConsole.newValue || {}).prompt;
  if (p != null && p !== elPrompt.value && document.activeElement !== elPrompt) { elPrompt.value = p; }
});

load();
document.addEventListener("i18n:changed", () => { render(); renderGroups(); renderTemplates(); updateSendLabel(); });
applyI18n();
