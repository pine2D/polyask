// console/archive.js — 归档只读页：amsArchive（汇总复制/导出时定格的「问题+各站回答」快照）的
// 列表与详情。md 重建与 console/status.js 的 buildSummary 对齐（本页无 console 全局，独立小实现）。
applyI18n();
const elList = document.getElementById("ar-list");
const elDetail = document.getElementById("ar-detail");
const elCopy = document.getElementById("ar-copy");
const elDel = document.getElementById("ar-del");
let archive = [];

function entryMd(e) {
  const md = ["# " + t("con_mdHeader") + " · " + new Date(e.ts).toLocaleString()];
  if (e.text) md.push("\n**" + t("con_mdQuestion") + "**: " + e.text);
  for (const r of e.results || []) {
    const tier = r.state === "think" ? " · " + t("con_mdThink") : r.state === "fast" ? " · " + t("con_mdFast") : "";
    md.push("\n## " + r.label + tier + "\n", r.text ? r.text : "> " + t("con_errNoAnswer"));
  }
  return md.join("\n");
}
function renderList() {
  elList.replaceChildren();
  archive.forEach((e, i) => {
    const o = document.createElement("option");
    o.value = String(i);
    const q = (e.text || "").length > 40 ? e.text.slice(0, 40) + "…" : (e.text || "—");
    o.textContent = new Date(e.ts).toLocaleString() + " · " + q;
    elList.appendChild(o);
  });
  elDetail.setAttribute("data-empty", t("arc_empty"));
  showCurrent();
}
function showCurrent() {
  const i = parseInt(elList.value, 10);
  const e = archive[i];
  elDetail.textContent = e ? entryMd(e) : "";
  elCopy.disabled = elDel.disabled = !e;
}
elList.addEventListener("change", showCurrent);
elCopy.addEventListener("click", () => {
  const e = archive[parseInt(elList.value, 10)];
  if (e) navigator.clipboard.writeText(entryMd(e)).then(() => { elCopy.textContent = t("arc_copied"); setTimeout(() => { elCopy.textContent = t("arc_copy"); }, 1500); });
});
elDel.addEventListener("click", () => {
  const i = parseInt(elList.value, 10);
  if (isNaN(i)) return;
  archive.splice(i, 1);
  chrome.storage.local.set({ amsArchive: archive });
  renderList();
});
chrome.storage.local.get("amsArchive", (o) => { archive = (o && o.amsArchive) || []; renderList(); });
document.addEventListener("i18n:changed", renderList);
