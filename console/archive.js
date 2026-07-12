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
// 详情区极简行级渲染（标题/引用/围栏/行内粗体，其余原样）：回看场景读内容而非 md 源码；
// 「复制」仍取 entryMd 源文（看=渲染，复制=可再粘贴的 Markdown）。全程 textContent 组装，无注入面。
function renderMd(md, box) {
  const add = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; box.appendChild(n); return n; };
  // 围栏状态机记录开栏长度：md.js 对含 ``` 的代码主动升级四反引号外栏（本项目正常产物），
  // 闭栏必须 ≥ 开栏长度且行内仅反引号——内层 ``` 不再提前截断（对抗审查批 B）
  let fenceLen = 0, codeBuf = [];
  for (const ln of md.split("\n")) {
    const f = ln.match(/^(`{3,})(.*)$/);
    if (fenceLen) {
      if (f && f[1].length >= fenceLen && !f[2].trim()) { add("pre", "ar-code", codeBuf.join("\n")); codeBuf = []; fenceLen = 0; }
      else codeBuf.push(ln);
      continue;
    }
    if (f) { fenceLen = f[1].length; continue; } // 开栏（f[2] 为语言标记，渲染不需要）
    const h = ln.match(/^(#{1,4})\s+(.*)/);
    if (h) { add("div", "ar-mh ar-mh" + h[1].length, h[2]); continue; }
    if (/^>\s?/.test(ln)) { add("div", "ar-quote", ln.replace(/^>\s?/, "")); continue; }
    const p = add("div", "ar-p");
    ln.split(/(\*\*[^*]+\*\*)/).forEach((seg) => {
      if (/^\*\*[^*]+\*\*$/.test(seg)) { const b = document.createElement("b"); b.textContent = seg.slice(2, -2); p.appendChild(b); }
      else if (seg) p.appendChild(document.createTextNode(seg));
    });
  }
  if (fenceLen && codeBuf.length) add("pre", "ar-code", codeBuf.join("\n")); // 未闭合围栏兜底
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
  elDetail.replaceChildren();
  if (e) renderMd(entryMd(e), elDetail);
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
