// console/compose.js — 伴侣编辑窗口（Task 5 最小骨架；Task 6 补双向同步与发送）
const elText = document.getElementById("ch-text");
chrome.storage.local.get("amsConsole", (o) => {
  const c = (o && o.amsConsole) || {};
  if (c.prompt) elText.value = c.prompt;
  elText.focus();
});
document.getElementById("ch-close").addEventListener("click", () => window.close());

// 读-改-写合并到 amsConsole（只动 prompt，避免覆盖 selected/tier；单用户低频，竞态可接受）
function patchConsole(patch, cb) {
  chrome.storage.local.get("amsConsole", (o) => {
    const c = Object.assign({}, (o && o.amsConsole) || {}, patch);
    chrome.storage.local.set({ amsConsole: c }, cb);
  });
}
let writeTimer = null;
elText.addEventListener("input", () => {
  clearTimeout(writeTimer);
  writeTimer = setTimeout(() => patchConsole({ prompt: elText.value }), 200); // 防抖写回
});

function renderScope(selected) {
  const chosen = SITES.filter((s) => selected[s.host]);
  const el = document.getElementById("ch-scope");
  el.replaceChildren();
  if (!chosen.length) { el.textContent = "未选择站点"; return; }
  el.append(document.createTextNode("将群发到 "));
  const b = document.createElement("b"); b.textContent = chosen.length + " 站"; el.append(b);
  el.append(document.createTextNode("：" + chosen.map((s) => s.label).join(" · ")));
}
chrome.storage.local.get("amsConsole", (o) => renderScope(((o && o.amsConsole) || {}).selected || {}));
chrome.storage.onChanged.addListener((ch, area) => {
  if (area !== "local" || !ch.amsConsole) return;
  const nv = ch.amsConsole.newValue || {};
  // 文本：外部（细条）改了且本框未在编辑 → 回填，避免打断输入与回环
  if (nv.prompt != null && nv.prompt !== elText.value && document.activeElement !== elText) elText.value = nv.prompt;
  renderScope(nv.selected || {});
});

document.getElementById("ch-back").addEventListener("click", () => {
  patchConsole({ prompt: elText.value }, () => window.close());
});
document.getElementById("ch-send").addEventListener("click", () => {
  const text = elText.value.trim(); if (!text) return;
  chrome.storage.local.get("amsConsole", (o) => {
    const c = (o && o.amsConsole) || {};
    const sel = c.selected || {};
    const sites = SITES.filter((s) => sel[s.host]); if (!sites.length) return;
    chrome.runtime.sendMessage({ source: "AMS_CONSOLE", action: "sendAll", sites, text, tier: c.tier || null });
    window.close();
  });
});
