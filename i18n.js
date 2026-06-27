// i18n.js — 运行时 UI 三语（popup/console/compose/内容脚本共用）。同步字典，避免 fetch/CSP/FOUC。
// 真值存 storage.sync.amsLang（默认 auto；popup 改）；扩展页镜像 localStorage 供同步启动。
// MSG 由各 surface 任务填充：{ key: { en, zh_CN, zh_TW } }
const MSG = {
  // —— 占位示例（I2+ 填充真实 key）——
  // sendAll: { en: "Send to all ▸", zh_CN: "发送到全部 ▸", zh_TW: "發送到全部 ▸" },
};
const I18N_LANGS = ["en", "zh_CN", "zh_TW"];
function _resolveAuto() {
  const ui = (chrome.i18n && chrome.i18n.getUILanguage && chrome.i18n.getUILanguage() || "en").toLowerCase();
  if (ui.startsWith("zh")) return (ui.includes("tw") || ui.includes("hk") || ui.includes("hant")) ? "zh_TW" : "zh_CN";
  return "en";
}
let _lang = "en";
function _setLangFrom(pref) {
  const p = pref || "auto";
  _lang = (p !== "auto" && I18N_LANGS.includes(p)) ? p : _resolveAuto();
  try { localStorage.amsLang = p; } catch (e) {} // 扩展页镜像；内容脚本 origin 不同，无害
}
// 启动同步：扩展页用 localStorage 镜像即时定语言（无 FOUC）；内容脚本拿不到则先 auto，稍后 storage 回写
try { _setLangFrom(localStorage.amsLang); } catch (e) { _setLangFrom("auto"); }
function t(key, ...subs) {
  const row = MSG[key];
  let s = (row && (row[_lang] || row.en)) || key;
  subs.forEach((v, i) => { s = s.split("{" + i + "}").join(String(v)); });
  return s;
}
function applyI18n(root) {
  root = root || document;
  root.querySelectorAll("[data-i18n]").forEach((el) => { el.textContent = t(el.getAttribute("data-i18n")); });
  root.querySelectorAll("[data-i18n-title]").forEach((el) => { el.title = t(el.getAttribute("data-i18n-title")); });
  root.querySelectorAll("[data-i18n-ph]").forEach((el) => { el.placeholder = t(el.getAttribute("data-i18n-ph")); });
  root.querySelectorAll("[data-i18n-aria]").forEach((el) => { el.setAttribute("aria-label", t(el.getAttribute("data-i18n-aria"))); });
}
// 权威值取 storage.sync；变更实时重应用 + 通知各 surface 重渲动态串
chrome.storage.sync.get({ amsLang: "auto" }, (v) => { _setLangFrom(v.amsLang); try { applyI18n(); } catch (e) {} document.dispatchEvent(new CustomEvent("i18n:changed")); });
chrome.storage.onChanged.addListener((c, area) => {
  if (area === "sync" && c.amsLang) { _setLangFrom(c.amsLang.newValue); try { applyI18n(); } catch (e) {} document.dispatchEvent(new CustomEvent("i18n:changed")); }
});
