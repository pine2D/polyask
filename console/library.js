// console/library.js — 输入物料层：历史 / 模板 / 分组（console.js 触及 300 行上限后拆出）。
// 在 sites.js 之后、console.js 之前加载：本层顶层只建状态与渲染函数，事件 handler 运行时
// console.js 的 save/render/chosen/startName/askDelete/elPrompt 已就位（classic script 共享全局）。

// —— 历史（Task 4 状态部分；↑↓ 键盘浏览留在 console.js 的 elPrompt keydown）——
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

// —— 模板（Task 6）——
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
