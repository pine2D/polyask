const SITES = [
  { host: "claude.ai", label: "Claude", url: "https://claude.ai/new", on: true },
  { host: "chatgpt.com", label: "ChatGPT", url: "https://chatgpt.com/", on: true },
  { host: "gemini.google.com", label: "Gemini", url: "https://gemini.google.com/app", on: true },
  { host: "chat.deepseek.com", label: "DeepSeek", url: "https://chat.deepseek.com/", on: false },
  { host: "www.doubao.com", label: "豆包", url: "https://www.doubao.com/chat/", on: false },
  { host: "www.qianwen.com", label: "千问", url: "https://www.qianwen.com/", on: false },
  { host: "www.kimi.com", label: "Kimi", url: "https://www.kimi.com/", on: false },
  { host: "yuanbao.tencent.com", label: "元宝", url: "https://yuanbao.tencent.com/chat/", on: false },
  { host: "chatglm.cn", label: "智谱", url: "https://chatglm.cn/main/alltoolsdetail", on: false },
];
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
    const lab = document.createElement("label");
    const cb = document.createElement("input");
    cb.type = "checkbox"; cb.checked = !!selected[s.host];
    cb.addEventListener("change", () => { selected[s.host] = cb.checked; save(); });
    const dot = document.createElement("span"); dot.className = "dot idle"; dot.dataset.dot = s.host;
    lab.append(cb, document.createTextNode(s.label), dot);
    elSites.appendChild(lab);
  });
}
function chosen() { return SITES.filter((s) => selected[s.host]); }

// Task 7: setDot 改为 state 签名（idle|send|done|fail），颜色/辉光由 CSS 控制
function setDot(host, state, title) {
  const d = document.querySelector('[data-dot="' + host + '"]');
  if (!d) return;
  d.className = "dot " + state;
  d.title = title || "";
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
  // Task 7: 重置为 idle state
  [...document.querySelectorAll('.dot')].forEach((d) => { d.className = "dot idle"; d.title = ""; });
});
elTier.addEventListener("change", save);
elPrompt.addEventListener("input", () => { histCursor = -1; save(); }); // 手打改字 → 复位游标（↑↓ 程序化设 value 不触发 input）

// Task 5: 预设分组
const PRESETS = {
  intl: ["claude.ai", "chatgpt.com", "gemini.google.com"],
  cn: ["chat.deepseek.com", "www.doubao.com", "www.qianwen.com", "www.kimi.com", "yuanbao.tencent.com", "chatglm.cn"],
};
function applyPreset(hosts) {
  SITES.forEach((s) => { selected[s.host] = hosts.includes(s.host); });
  save(); render();
}
document.getElementById("preset-intl").addEventListener("click", () => applyPreset(PRESETS.intl));
document.getElementById("preset-cn").addEventListener("click", () => applyPreset(PRESETS.cn));
document.getElementById("preset-all").addEventListener("click", () => {
  const allOn = SITES.every((s) => selected[s.host]);
  SITES.forEach((s) => { selected[s.host] = !allOn; }); // 已全选则全不选
  save(); render();
});

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
