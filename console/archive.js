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
  disarmDel(); // 任何重渲染（i18n 切换/storage 变更）都撤销删除确认态，防确认目标漂移
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
// 删除二段确认（与 console 删模板/分组的确认保护一致，归档是不可恢复的完整对比现场）：
// 首击按钮变「确认删除？」危险态并绑定目标条目（ts 唯一标识），3s 内对同一条目再击才删；
// 超时/换条目/任何重渲染（renderList 首行）都撤销确认——确认目标绝不漂移（对抗审查 F1）。
let delArmedUntil = 0, delArmedTs = null;
function disarmDel() { delArmedUntil = 0; delArmedTs = null; elDel.textContent = t("arc_del"); elDel.classList.remove("danger"); }
elDel.addEventListener("click", () => {
  const cur = archive[parseInt(elList.value, 10)];
  if (!cur) return;
  if (Date.now() > delArmedUntil || delArmedTs !== cur.ts) {
    delArmedUntil = Date.now() + 3000; delArmedTs = cur.ts;
    elDel.textContent = t("arc_delConfirm"); elDel.classList.add("danger");
    setTimeout(() => { if (delArmedUntil && Date.now() >= delArmedUntil) disarmDel(); }, 3100);
    return;
  }
  disarmDel();
  // 先重读最新库、按 ts 定位删除（对抗审查 F2）：本页数组是打开时的快照，console 侧汇总
  // 会并发追加新快照——对陈旧快照 splice 整值回写会把新快照抹掉。ponytail: 不设后台串行
  // 入口——写方仅两处且无并发定时器，重读+onChanged 刷新已把竞态窗口缩到毫秒级。
  chrome.storage.local.get("amsArchive", (o) => {
    chrome.storage.local.set({ amsArchive: ((o && o.amsArchive) || []).filter((e) => e.ts !== cur.ts) });
  });
});
elList.addEventListener("change", disarmDel); // 换条目即撤销待确认态，防误删别的条目
// 库变更（console 侧新增快照 / 本页删除落盘）→ 刷新列表；本页数组因此常新，不再长寿陈旧
chrome.storage.onChanged.addListener((ch, area) => {
  if (area === "local" && ch.amsArchive) { archive = ch.amsArchive.newValue || []; renderList(); }
});
chrome.storage.local.get("amsArchive", (o) => { archive = (o && o.amsArchive) || []; renderList(); });
document.addEventListener("i18n:changed", renderList);
