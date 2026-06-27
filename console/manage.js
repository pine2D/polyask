// console/manage.js — 分组/模板的「命名」与「删除二次确认」两个细条内联交互。
// 之所以内联：96px 窗口会裁切 prompt()/confirm()/自定义浮层（实测）。
// 复用 console.js 的全局：templates / groups / renderTemplates / renderGroups。本文件在 console.js 之后加载。

// —— 内联命名（替代被裁切的 prompt()）：点 ＋ 后在细条内就地起名 + 回车 ——
const elName = document.getElementById("nameinput");
let pendingSave = null; // {kind:"tpl", text} | {kind:"grp", hosts}
function startName(kind, placeholder, payload) {
  pendingSave = Object.assign({ kind }, payload);
  elName.value = ""; elName.placeholder = placeholder;
  elName.style.display = ""; elName.focus();
}
function cancelName() { pendingSave = null; elName.value = ""; elName.style.display = "none"; }
function commitName() {
  if (!pendingSave) return;
  const name = elName.value.trim();
  if (pendingSave.kind === "tpl") {                         // 模板名可留空
    templates = [...templates, { name, text: pendingSave.text }];
    chrome.storage.local.set({ amsTemplates: templates });
    renderTemplates();
  } else if (pendingSave.kind === "grp") {                  // 分组名必填
    if (!name) { cancelName(); return; }
    groups = [...groups.filter((g) => g.name !== name), { name, hosts: pendingSave.hosts }];
    chrome.storage.local.set({ amsGroups: groups });
    renderGroups();
  }
  cancelName();
}
elName.addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); commitName(); }
  else if (e.key === "Escape") { e.preventDefault(); cancelName(); }
});
elName.addEventListener("blur", () => { if (pendingSave) cancelName(); }); // 失焦即取消

// —— 删除二次确认：细条内联确认条（替代会被裁切的 confirm()/浮层）——
let pendingDelete = null; // {kind:"grp"|"tpl", index}
const elConfirm = document.getElementById("confirmbar");
const elConfirmText = document.getElementById("confirmtext");
function askDelete(kind, index, name) {
  pendingDelete = { kind, index };
  elConfirmText.textContent = (kind === "grp" ? "删除分组「" : "删除模板「") + name + "」？";
  elConfirm.style.display = "";
  document.getElementById("confirm-no").focus(); // 默认落在「取消」，更安全
}
function closeConfirm() { pendingDelete = null; elConfirm.style.display = "none"; }
document.getElementById("confirm-yes").addEventListener("click", () => {
  if (!pendingDelete) return;
  if (pendingDelete.kind === "grp") {
    groups = groups.filter((_, i) => i !== pendingDelete.index);
    chrome.storage.local.set({ amsGroups: groups }); renderGroups();
  } else {
    templates = templates.filter((_, i) => i !== pendingDelete.index);
    chrome.storage.local.set({ amsTemplates: templates }); renderTemplates();
  }
  closeConfirm();
});
document.getElementById("confirm-no").addEventListener("click", closeConfirm);
elConfirm.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.preventDefault(); closeConfirm(); } });
