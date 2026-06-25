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

function render() {
  elSites.replaceChildren();
  SITES.forEach((s) => {
    const lab = document.createElement("label");
    const cb = document.createElement("input");
    cb.type = "checkbox"; cb.checked = !!selected[s.host];
    cb.addEventListener("change", () => { selected[s.host] = cb.checked; save(); });
    const dot = document.createElement("span"); dot.className = "dot"; dot.dataset.dot = s.host;
    lab.append(cb, document.createTextNode(s.label), dot);
    elSites.appendChild(lab);
  });
}
function chosen() { return SITES.filter((s) => selected[s.host]); }
function setDot(host, color, title) {
  const d = document.querySelector('[data-dot="' + host + '"]');
  if (d) { d.style.background = color; d.title = title || ""; }
}
function applyResults(results) {
  (results || []).forEach((r) => {
    if (typeof r.ok === "boolean") {
      // broadcast 结果：ok=提交成功
      setDot(r.host, r.ok ? "#16a34a" : "#dc2626", r.reason || "");
    } else {
      // openTile 结果：windowId 非空=开窗/复用成功
      const okWin = r.windowId != null;
      setDot(r.host, okWin ? "#16a34a" : "#dc2626", r.reused ? "复用" : r.opened ? "已开" : "失败");
    }
  });
}
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
    render();
  });
}
document.getElementById("tile").addEventListener("click", () => {
  const sites = chosen(); if (!sites.length) return;
  sites.forEach((s) => setDot(s.host, "#9ca3af", "开窗中"));
  chrome.runtime.sendMessage({ source: "AMS_CONSOLE", action: "openTile", sites }, (resp) => applyResults(resp && resp.results));
});
document.getElementById("send").addEventListener("click", () => {
  const sites = chosen(); if (!sites.length) return;
  const text = elPrompt.value.trim(); if (!text) return;
  sites.forEach((s) => setDot(s.host, "#9ca3af", "发送中"));
  chrome.runtime.sendMessage({ source: "AMS_CONSOLE", action: "broadcast", sites, text, tier: elTier.value || null }, (resp) => applyResults(resp && resp.results));
});
document.getElementById("focusall").addEventListener("click", () => {
  const sites = chosen(); if (sites.length) chrome.runtime.sendMessage({ source: "AMS_CONSOLE", action: "focusAll", sites });
});
document.getElementById("minall").addEventListener("click", () => {
  const sites = chosen(); if (sites.length) chrome.runtime.sendMessage({ source: "AMS_CONSOLE", action: "minimizeAll", sites });
});
elTier.addEventListener("change", save);
elPrompt.addEventListener("input", save);
load();
