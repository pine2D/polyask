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
  con_promptPh: { en: "Ask a question to broadcast… (Enter to send · ↑↓ history)", zh_CN: "输入要群发的问题…（Enter 发送 · ↑↓ 历史）", zh_TW: "輸入要群發的問題…（Enter 發送 · ↑↓ 歷史）" },
  con_sendAll: { en: "Send to all ▸", zh_CN: "发送到全部 ▸", zh_TW: "群發到全部 ▸" },
  con_tile: { en: "Tile", zh_CN: "平铺", zh_TW: "平鋪" },
  con_composeTitle: { en: "Open text editor", zh_CN: "展开编辑长文本", zh_TW: "展開編輯長文字" },
  con_retryTitle: { en: "Retry failed sites", zh_CN: "重试失败的站点", zh_TW: "重試失敗的站點" },
  con_newSessionTitle: { en: "New session for all (reload each window)", zh_CN: "全部新会话（各窗重载到新会话）", zh_TW: "全部新對話（各視窗重載到新對話）" },
  con_closeAllTitle: { en: "Close all windows opened by console", zh_CN: "关闭控制台开启的全部窗口", zh_TW: "關閉主控台開啟的全部視窗" },
  con_grpSaveTitle: { en: "Save current selection as group", zh_CN: "把当前勾选存为分组", zh_TW: "將目前勾選儲存為群組" },
  con_grpDelTitle: { en: "Delete selected custom group", zh_CN: "删除选中的自定义分组", zh_TW: "刪除選取的自訂群組" },
  con_groupTitle: { en: "Group: presets + custom", zh_CN: "分组：预设 + 自定义", zh_TW: "群組：預設 + 自訂" },
  con_groupAria: { en: "Site group", zh_CN: "站点分组", zh_TW: "站點群組" },
  con_tierTitle: { en: "Tier before send", zh_CN: "发送前档位", zh_TW: "發送前檔位" },
  con_tplTitle: { en: "Prompt template", zh_CN: "提示词模板", zh_TW: "提示詞範本" },
  con_nameAria: { en: "Name (template / group)", zh_CN: "名称（模板/分组）", zh_TW: "名稱（範本／群組）" },
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
  cmp_title:       { en: "Edit broadcast question",    zh_CN: "编辑群发问题",    zh_TW: "編輯群發問題" },
  cmp_ph:          { en: "Enter your broadcast question…", zh_CN: "输入要群发的问题…", zh_TW: "輸入要群發的問題…" },
  cmp_close:       { en: "Close",                      zh_CN: "关闭",            zh_TW: "關閉" },
  cmp_back:        { en: "Fill back & close",           zh_CN: "回填并关闭",      zh_TW: "回填並關閉" },
  cmp_send:        { en: "Send to all ▸",               zh_CN: "发送到全部 ▸",    zh_TW: "群發到全部 ▸" },
  cmp_scopeNone:   { en: "No sites selected",           zh_CN: "未选择站点",      zh_TW: "未選擇站點" },
  cmp_scopePrefix: { en: "Broadcasting to ",            zh_CN: "将群发到 ",       zh_TW: "將群發到 " },
  cmp_scopeN:      { en: "{0} sites",                   zh_CN: "{0} 站",          zh_TW: "{0} 站" },
  cmp_scopeColon:  { en: ": ",                          zh_CN: "：",              zh_TW: "：" },
  // —— popup 段（I4）——
  pop_think:       { en: "🧠 Deep Think",                                zh_CN: "🧠 深度思考",                       zh_TW: "🧠 深度思考" },
  pop_fast:        { en: "⚡ Fast Model",                                zh_CN: "⚡ 快速模型",                       zh_TW: "⚡ 快速模型" },
  pop_openConsole: { en: "🗂 Open Broadcast Console",                   zh_CN: "🗂 打开广播控制台",                 zh_TW: "🗂 開啟群發主控台" },
  pop_unsupported: { en: "Current page is not a supported AI site",     zh_CN: "当前页面不是受支持的 AI 站点",      zh_TW: "目前頁面不是受支援的 AI 站點" },
  pop_grpLegend:   { en: "Broadcast",                                   zh_CN: "群发",                              zh_TW: "群發" },
  pop_autoRaise:   { en: "Auto-raise all windows after send",           zh_CN: "发送后自动置顶全部窗口",            zh_TW: "群發後自動置頂全部視窗" },
  pop_themeLegend: { en: "Console theme (broadcast & compose)",         zh_CN: "控制台主题（含群发控制台与编辑窗）", zh_TW: "主控台主題（含群發主控台與編輯窗）" },
  pop_themeAuto:   { en: "Auto",                                        zh_CN: "随系统",                            zh_TW: "隨系統" },
  pop_themeLight:  { en: "Light",                                       zh_CN: "亮色",                              zh_TW: "亮色" },
  pop_themeDark:   { en: "Dark",                                        zh_CN: "暗色",                              zh_TW: "暗色" },
  pop_dmLegend:    { en: "Floating widget",                             zh_CN: "悬浮控件显示",                      zh_TW: "浮動控件顯示" },
  pop_dmHandle:    { en: "Edge handle (hover to expand)",               zh_CN: "贴边把手（悬停展开）",              zh_TW: "貼邊把手（懸停展開）" },
  pop_dmAlways:    { en: "Always show",                                 zh_CN: "始终显示",                          zh_TW: "始終顯示" },
  pop_dmHidden:    { en: "Hidden (shortcuts only)",                     zh_CN: "隐藏（仅快捷键）",                  zh_TW: "隱藏（僅快捷鍵）" },
  pop_diagLegend:  { en: "Health check",                                zh_CN: "健康自检",                          zh_TW: "健康自檢" },
  pop_diag:        { en: "🩺 Diagnose current site",                    zh_CN: "🩺 诊断当前站点",                   zh_TW: "🩺 診斷目前站點" },
  pop_diagStale:   { en: "Site may have changed or language not adapted", zh_CN: "站点可能改版或语言未适配",        zh_TW: "站點可能改版或語言未適配" },
  pop_langLegend:  { en: "Language",                                    zh_CN: "语言 / Language",                   zh_TW: "語言 / Language" },
  pop_langAuto:    { en: "Auto",                                        zh_CN: "随系统",                            zh_TW: "隨系統" },
  pop_rebind:          { en: "Rebind",                   zh_CN: "改键",        zh_TW: "改鍵" },
  pop_diagUnsupported: { en: "Current page not supported", zh_CN: "当前页面不支持", zh_TW: "目前頁面不支援" },
  pop_shortcutUnset:   { en: "not set",                  zh_CN: "未设置",      zh_TW: "未設定" },
  // —— content-script 段（I5）——
  cs_switchedThink:  { en: "Switched: Deep Think",                              zh_CN: "已切到：深度思考",                zh_TW: "已切到：深度思考" },
  cs_switchedFast:   { en: "Switched: Fast Model",                              zh_CN: "已切到：快速模型",                zh_TW: "已切到：快速模型" },
  cs_stopped:        { en: "Stopped",                                           zh_CN: "已停止",                          zh_TW: "已停止" },
  cs_switchFail:     { en: "Switch failed: {0}",                                zh_CN: "切换失败：{0}",                   zh_TW: "切換失敗：{0}" },
  cs_switchUnstable: { en: "Switch not confirmed, sending as current tier",     zh_CN: "切换未稳定生效，按当前档发送",    zh_TW: "切換未穩定生效，依目前檔發送" },
  cs_pillThink:      { en: "🧠 Think",                                          zh_CN: "🧠 思考",                        zh_TW: "🧠 思考" },
  cs_pillFast:       { en: "⚡ Fast",                                           zh_CN: "⚡ 快速",                        zh_TW: "⚡ 快速" },
  cs_pillThinkTitle: { en: "Deep Think (Alt+T)",                                zh_CN: "深度思考 (Alt+T)",                zh_TW: "深度思考 (Alt+T)" },
  cs_pillFastTitle:  { en: "Fast Model (Alt+Y)",                                zh_CN: "快速模型 (Alt+Y)",                zh_TW: "快速模型 (Alt+Y)" },
  cs_pillHandleTitle:{ en: "AI Model Switcher",                                 zh_CN: "AI Model Switcher",               zh_TW: "AI Model Switcher" },
  cs_siteAdapter:    { en: "Site adapter",                                      zh_CN: "站点适配器",                      zh_TW: "站點適配器" },
  cs_diagError:      { en: "diagnose error",                                    zh_CN: "diagnose 异常",                   zh_TW: "diagnose 異常" },
  // —— diagnose 检查名（I5）——
  diag_modelEntry:   { en: "Model entry",                                       zh_CN: "模型入口",                        zh_TW: "模型入口" },
  diag_modelReadable:{ en: "Model readable",                                    zh_CN: "模型可读",                        zh_TW: "模型可讀" },
  diag_tierReadable: { en: "Tier readable",                                     zh_CN: "档位可读",                        zh_TW: "檔位可讀" },
  diag_iframeLimited:{ en: "iframe limited: haiku only (Claude embed — use standalone tab)", zh_CN: "iframe 受限：仅 haiku（claude 官方嵌入门，请在独立标签使用）", zh_TW: "iframe 受限：僅 haiku（claude 官方嵌入，請在獨立分頁使用）" },
  diag_intelEntry:   { en: "Intelligence entry",                                zh_CN: "Intelligence 入口",               zh_TW: "Intelligence 入口" },
  diag_deepThink:    { en: "DeepThink toggle",                                  zh_CN: "DeepThink 开关",                  zh_TW: "DeepThink 開關" },
  diag_modeSelect:   { en: "Mode select",                                       zh_CN: "模式选择",                        zh_TW: "模式選擇" },
  diag_modeBtn:      { en: "Mode button",                                       zh_CN: "模式按钮",                        zh_TW: "模式按鈕" },
  diag_modelDropdown:{ en: "Model dropdown",                                    zh_CN: "模型下拉",                        zh_TW: "模型下拉" },
  diag_thinkBtn:     { en: "Thinking toggle",                                   zh_CN: "思考开关",                        zh_TW: "思考開關" },
  diag_deepThinking: { en: "Deep Thinking toggle",                              zh_CN: "Deep Thinking 开关",              zh_TW: "Deep Thinking 開關" },
  diag_thinkButton:  { en: "Thinking button",                                   zh_CN: "思考按钮",                        zh_TW: "思考按鈕" },
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
