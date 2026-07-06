// console/compose.js — 伴侣编辑窗口（Task 5 最小骨架；Task 6 补双向同步与发送；Task 9 补 i18n）
applyI18n(); // 静态元素首屏本地化（i18n.js 在 head 同步加载，此处安全调用）
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
  if (!chosen.length) { el.textContent = t("cmp_scopeNone"); return; }
  el.append(document.createTextNode(t("cmp_scopePrefix")));
  const b = document.createElement("b"); b.textContent = t("cmp_scopeN", chosen.length); el.append(b);
  el.append(document.createTextNode(t("cmp_scopeColon") + chosen.map((s) => s.label).join(" · ")));
}
chrome.storage.local.get("amsConsole", (o) => renderScope(((o && o.amsConsole) || {}).selected || {}));
chrome.storage.onChanged.addListener((ch, area) => {
  if (area !== "local" || !ch.amsConsole) return;
  const nv = ch.amsConsole.newValue || {};
  // 文本：外部（细条）改了且本框未在编辑 → 回填。"编辑中"须同时窗口持焦：窗口失焦后
  // activeElement 不重置，单看它会永久挡住回填，「回填并关闭」就会拿旧文覆盖细条新编辑。
  if (nv.prompt != null && nv.prompt !== elText.value && !(document.hasFocus() && document.activeElement === elText)) elText.value = nv.prompt;
  renderScope(nv.selected || {});
});

document.addEventListener("i18n:changed", () => {
  applyI18n();
  chrome.storage.local.get("amsConsole", (o) => renderScope(((o && o.amsConsole) || {}).selected || {}));
});

document.getElementById("ch-back").addEventListener("click", () => {
  patchConsole({ prompt: elText.value }, () => window.close());
});
function shake(el) { el.classList.remove("shake"); void el.offsetWidth; el.classList.add("shake"); } // 与细条同款空态反馈
elText.addEventListener("keydown", (e) => { // 长文场景键盘闭环：Ctrl/Cmd+Enter 发送
  if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && !e.isComposing) { e.preventDefault(); document.getElementById("ch-send").click(); }
});
document.getElementById("ch-send").addEventListener("click", () => {
  const text = elText.value.trim(); if (!text) { shake(elText); return; }
  chrome.storage.local.get("amsConsole", (o) => {
    const c = (o && o.amsConsole) || {};
    const sel = c.selected || {};
    const sites = SITES.filter((s) => sel[s.host]); if (!sites.length) { shake(document.getElementById("ch-scope")); return; }
    chrome.storage.local.get("amsHistory", (h) => {
      const hist = [text, ...((h && h.amsHistory) || []).filter((x) => x !== text)].slice(0, 20);
      chrome.storage.local.set({ amsHistory: hist });
      chrome.runtime.sendMessage({ source: "AMS_CONSOLE", action: "sendAll", sites, text, tier: c.tier || null });
      window.close();
    });
  });
});
