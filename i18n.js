// i18n.js — 运行时 UI 三语（popup/console/compose/内容脚本共用）。同步字典，避免 fetch/CSP/FOUC。
// 真值存 storage.sync.amsLang（默认 auto；popup 改）；扩展页镜像 localStorage 供同步启动。
// MSG 由各 surface 任务填充：{ key: { en, zh_CN, zh_TW } }
const MSG = {
  // —— console 段（I2）——
  con_groupPh: { en: "Group▾", zh_CN: "分组▾", zh_TW: "分組▾" },
  con_tierKeep: { en: "Tier: keep", zh_CN: "档位：不变", zh_TW: "檔位：不變" },
  con_tierThink: { en: "🧠 Deep think", zh_CN: "🧠 深度思考", zh_TW: "🧠 深度思考" },
  con_tierFast: { en: "⚡ Fast", zh_CN: "⚡ 快速", zh_TW: "⚡ 快速" },
  con_tplPh: { en: "Template▾", zh_CN: "模板▾", zh_TW: "範本▾" },
  con_promptPh: { en: "Ask a question to broadcast… (Enter to send · ↑↓ history)", zh_CN: "输入要群发的问题…（Enter 发送 · ↑↓ 历史）", zh_TW: "輸入要廣播的問題…（Enter 發送 · ↑↓ 歷史）" },
  con_sendAll: { en: "Send to all ▸", zh_CN: "发送到全部 ▸", zh_TW: "發送到全部 ▸" },
  con_tile: { en: "Tile", zh_CN: "平铺", zh_TW: "平鋪" },
  con_composeTitle: { en: "Open text editor", zh_CN: "展开编辑长文本", zh_TW: "展開編輯長文字" },
  con_retryTitle: { en: "Retry failed sites", zh_CN: "重试失败的站点", zh_TW: "重試失敗的站點" },
  con_newSessionTitle: { en: "New session for all (reload each window)", zh_CN: "全部新会话（各窗重载到新会话）", zh_TW: "全部新對話（各視窗重載到新對話）" },
  con_closeAllTitle: { en: "Close all windows opened by console", zh_CN: "关闭控制台开启的全部窗口", zh_TW: "關閉主控台開啟的全部視窗" },
  con_grpSaveTitle: { en: "Save current selection as group", zh_CN: "把当前勾选存为分组", zh_TW: "將目前勾選儲存為群組" },
  con_grpDelTitle: { en: "Delete selected custom group", zh_CN: "删除选中的自定义分组", zh_TW: "刪除選取的自訂群組" },
  con_tplSaveTitle: { en: "Save current input as template", zh_CN: "保存当前输入为模板", zh_TW: "儲存目前輸入為範本" },
  con_tplDelTitle: { en: "Delete selected template", zh_CN: "删除选中模板", zh_TW: "刪除選取的範本" },
  con_delete: { en: "Delete", zh_CN: "删除", zh_TW: "刪除" },
  con_cancel: { en: "Cancel", zh_CN: "取消", zh_TW: "取消" },
  con_sending: { en: "Sending {0}/{1}", zh_CN: "发送中 {0}/{1}", zh_TW: "發送中 {0}/{1}" },
  con_winOpening: { en: "Opening…", zh_CN: "开窗中", zh_TW: "開窗中" },
  con_sendingTile: { en: "Opening/Sending…", zh_CN: "开窗/发送中", zh_TW: "開窗／發送中" },
  con_reused: { en: "Reused", zh_CN: "复用", zh_TW: "複用" },
  con_opened: { en: "Opened", zh_CN: "已开", zh_TW: "已開" },
  con_failed: { en: "Failed", zh_CN: "失败", zh_TW: "失敗" },
  con_timeout: { en: "Timed out", zh_CN: "超时未就绪", zh_TW: "逾時未就緒" },
  con_grpNamePh: { en: "Group name (Enter to save)", zh_CN: "分组名称（回车保存）", zh_TW: "群組名稱（Enter 儲存）" },
  con_tplNamePh: { en: "Template name (optional, Enter to save)", zh_CN: "模板名称（可留空，回车保存）", zh_TW: "範本名稱（可留空，Enter 儲存）" },
  con_delGroup: { en: 'Delete group "{0}"?', zh_CN: "删除分组「{0}」？", zh_TW: "刪除群組「{0}」？" },
  con_delTpl: { en: 'Delete template "{0}"?', zh_CN: "删除模板「{0}」？", zh_TW: "刪除範本「{0}」？" },
  con_grpAll: { en: "All", zh_CN: "全部", zh_TW: "全部" },
  con_grpNone: { en: "None", zh_CN: "清空", zh_TW: "清空" },
  con_grpSection: { en: "Presets", zh_CN: "预设", zh_TW: "預設" },
  con_grpMine: { en: "My groups", zh_CN: "我的分组", zh_TW: "我的群組" },
  con_sendingDot: { en: "Sending…", zh_CN: "发送中", zh_TW: "發送中" },
  // —— compose 段（I3）——
  cmp_title:       { en: "Edit broadcast question",    zh_CN: "编辑群发问题",    zh_TW: "編輯廣播問題" },
  cmp_ph:          { en: "Enter your broadcast question…", zh_CN: "输入要群发的问题…", zh_TW: "輸入要廣播的問題…" },
  cmp_close:       { en: "Close",                      zh_CN: "关闭",            zh_TW: "關閉" },
  cmp_back:        { en: "Fill back & close",           zh_CN: "回填并关闭",      zh_TW: "回填並關閉" },
  cmp_send:        { en: "Send to all ▸",               zh_CN: "发送到全部 ▸",    zh_TW: "發送到全部 ▸" },
  cmp_scopeNone:   { en: "No sites selected",           zh_CN: "未选择站点",      zh_TW: "未選擇站點" },
  cmp_scopePrefix: { en: "Broadcasting to ",            zh_CN: "将群发到 ",       zh_TW: "將廣播到 " },
  cmp_scopeN:      { en: "{0} sites",                   zh_CN: "{0} 站",          zh_TW: "{0} 站" },
  cmp_scopeColon:  { en: ": ",                          zh_CN: "：",              zh_TW: "：" },
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
