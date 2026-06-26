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
  const ph = document.createElement("option"); ph.value = ""; ph.textContent = "模板▾";
  elTpl.appendChild(ph);
  templates.forEach((t, i) => {
    const o = document.createElement("option");
    o.value = String(i);
    o.textContent = t.length > 24 ? t.slice(0, 24) + "…" : t;
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
const BUILTINS = [
  { key: "intl", name: "国际", hosts: PRESETS.intl },
  { key: "cn", name: "国产", hosts: PRESETS.cn },
  { key: "all", name: "全部", hosts: SITES.map((s) => s.host) },
  { key: "none", name: "清空", hosts: [] },
];
function renderGroups() {
  elGroup.replaceChildren();
  const ph = document.createElement("option"); ph.value = ""; ph.textContent = "分组▾"; elGroup.appendChild(ph);
  const og1 = document.createElement("optgroup"); og1.label = "预设";
  BUILTINS.forEach((b) => { const o = document.createElement("option"); o.value = "b:" + b.key; o.textContent = b.name; og1.appendChild(o); });
  elGroup.appendChild(og1);
  if (groups.length) {
    const og2 = document.createElement("optgroup"); og2.label = "我的分组";
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
function syncGroupSelect() { elGroup.value = matchGroupValue(); }
elGroup.addEventListener("change", () => {
  const hosts = hostsOfValue(elGroup.value);
  if (hosts) applyHosts(hosts); else syncGroupSelect();
});
document.getElementById("grp-save").addEventListener("click", () => {
  const hosts = chosen().map((s) => s.host);
  if (!hosts.length) return;
  const name = (prompt("分组名称") || "").trim();
  if (!name) return;
  groups = [...groups.filter((g) => g.name !== name), { name, hosts }];
  chrome.storage.local.set({ amsGroups: groups });
  renderGroups();
});
document.getElementById("grp-del").addEventListener("click", () => {
  const v = elGroup.value;
  if (!v.startsWith("g:")) return; // 仅自定义可删
  groups = groups.filter((_, idx) => idx !== parseInt(v.slice(2), 10));
  chrome.storage.local.set({ amsGroups: groups });
  renderGroups();
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
      setDot(r.host, okWin ? "done" : "fail", r.reused ? "复用" : r.opened ? "已开" : "失败");
    }
  });
}
// 逐站实时回填：sendAll 期间每站一完成，background 即推单站结果，立刻更新该站圆点（不等全部）
chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.from === "AMS_BG" && msg.type === "siteResult" && msg.result) applyResults([msg.result]);
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
    chrome.storage.local.get("amsTemplates", (t) => { templates = (t && t.amsTemplates) || []; renderTemplates(); });
    chrome.storage.local.get("amsGroups", (g) => { groups = (g && g.amsGroups) || []; renderGroups(); });
  });
}
document.getElementById("tile").addEventListener("click", () => {
  const sites = chosen(); if (!sites.length) return;
  // Task 7: 改用 state "send"
  sites.forEach((s) => setDot(s.host, "send", "开窗中"));
  chrome.runtime.sendMessage({ source: "AMS_CONSOLE", action: "openTile", sites }, (resp) => applyResults(resp && resp.results));
});
document.getElementById("send").addEventListener("click", () => {
  const sites = chosen(); if (!sites.length) return;
  const text = elPrompt.value.trim(); if (!text) return;
  // Task 4: 入栈历史
  pushHistory(text);
  // Task 7: 改用 state "send"（sendAll 会按需先开窗，故文案含"开窗"）
  sites.forEach((s) => setDot(s.host, "send", "开窗/发送中"));
  chrome.runtime.sendMessage({ source: "AMS_CONSOLE", action: "sendAll", sites, text, tier: elTier.value || null }, (resp) => applyResults(resp && resp.results));
});
document.getElementById("focusall").addEventListener("click", () => {
  const sites = chosen(); if (sites.length) chrome.runtime.sendMessage({ source: "AMS_CONSOLE", action: "focusAll", sites });
});
document.getElementById("minall").addEventListener("click", () => {
  const sites = chosen(); if (sites.length) chrome.runtime.sendMessage({ source: "AMS_CONSOLE", action: "minimizeAll", sites });
});
document.getElementById("newsession").addEventListener("click", () => {
  const sites = chosen(); if (sites.length) chrome.runtime.sendMessage({ source: "AMS_CONSOLE", action: "newSession", sites });
});
document.getElementById("closeall").addEventListener("click", () => {
  chrome.runtime.sendMessage({ source: "AMS_CONSOLE", action: "closeAll" });
  [...document.querySelectorAll('.chip')].forEach((c) => { c.classList.remove("send", "done", "fail"); c.title = c.dataset.label; });
});
elTier.addEventListener("change", save);
elPrompt.addEventListener("input", () => { histCursor = -1; save(); }); // 手打改字 → 复位游标（↑↓ 程序化设 value 不触发 input）

// Task 6: 模板接线
elTpl.addEventListener("change", () => {
  const i = parseInt(elTpl.value, 10);
  if (!isNaN(i) && templates[i] != null) { elPrompt.value = templates[i]; save(); elPrompt.focus(); }
});
document.getElementById("tpl-save").addEventListener("click", () => {
  const t = elPrompt.value.trim();
  if (!t || templates.includes(t)) return;
  templates = [...templates, t];
  chrome.storage.local.set({ amsTemplates: templates });
  renderTemplates();
});
document.getElementById("tpl-del").addEventListener("click", () => {
  const i = parseInt(elTpl.value, 10);
  if (isNaN(i)) return;
  templates = templates.filter((_, idx) => idx !== i);
  chrome.storage.local.set({ amsTemplates: templates });
  renderTemplates();
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

load();
