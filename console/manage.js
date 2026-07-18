// console/manage.js — 分组/模板的「命名」与「删除二次确认」两个细条内联交互。
// 之所以内联：96px 窗口会裁切 prompt()/confirm()/自定义浮层（实测）。
// 复用 console.js 的全局：templates / groups / renderTemplates / renderGroups。本文件在 console.js 之后加载。

// —— 内联命名（替代被裁切的 prompt()）：点 ＋ 后在细条内就地起名 + 回车 ——
const elName = document.getElementById("nameinput");
let pendingSave = null; // {kind:"tpl", text} | {kind:"grp", hosts}
let nameOpener = null;  // 触发命名的按钮：收尾归还焦点，键盘用户不必从头 Tab（blur 主动移开除外）
function startName(kind, placeholder, payload) {
  cancelConfirm(false);                        // 与删除确认互斥；删除分组的临时选站副作用同时恢复
  nameOpener = document.activeElement;
  pendingSave = Object.assign({ kind }, payload);
  elName.value = ""; elName.placeholder = placeholder;
  elName.style.display = ""; elName.focus();
}
function cancelName(restoreFocus) {
  pendingSave = null; elName.value = ""; elName.style.display = "none";
  if (restoreFocus && nameOpener) { try { nameOpener.focus(); } catch (e) {} }
  nameOpener = null;
}
function commitName() {
  if (!pendingSave) return;
  const name = elName.value.trim();
  if (pendingSave.kind === "tpl") {                         // 模板名可留空
    templates = [...templates, { name, text: pendingSave.text }];
    chrome.storage.local.set({ amsTemplates: templates });
    renderTemplates();
  } else if (pendingSave.kind === "grp") {                  // 分组名必填
    if (!name) { cancelName(true); return; }
    groups = [...groups.filter((g) => g.name !== name), { name, hosts: pendingSave.hosts }];
    chrome.storage.local.set({ amsGroups: groups });
    renderGroups();
  }
  cancelName(true);
}
elName.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.isComposing) { e.preventDefault(); commitName(); } // 输入法合成中不误存
  else if (e.key === "Escape") { e.preventDefault(); cancelName(true); }
});
elName.addEventListener("blur", () => { if (pendingSave) cancelName(false); }); // 失焦即取消（用户主动移开，不抢焦点）

// —— 删除二次确认：细条内联确认条（替代会被裁切的 confirm()/浮层）——
let pendingDelete = null; // {kind:"grp"|"tpl", index}
let confirmOpener = null; // 触发删除确认的按钮：收尾归还焦点
const elConfirm = document.getElementById("confirmbar");
const elConfirmText = document.getElementById("confirmtext");
function askDelete(kind, index, name) {
  cancelName(false);                           // 与命名互斥：避免两个内联控件同现 + 提交同名分组致索引漂移删错
  confirmOpener = document.activeElement;
  pendingDelete = { kind, index };
  elConfirmText.textContent = t(kind === "grp" ? "con_delGroup" : "con_delTpl", name);
  elConfirm.style.display = "";
  document.getElementById("confirm-no").focus(); // 默认落在「取消」，更安全
}
function closeConfirm(restoreFocus) {
  pendingDelete = null; elConfirm.style.display = "none";
  if (restoreFocus !== false && confirmOpener) { try { confirmOpener.focus(); } catch (e) {} }
  confirmOpener = null;
}
function cancelConfirm(restoreFocus) {
  if (pendingDelete && pendingDelete.kind === "grp") restoreGroupSel();
  closeConfirm(restoreFocus);
}
// 删除分组的流程副作用恢复：删除前必须先在下拉选中该组，而选中即 applyHosts 覆盖了当前勾选——
// 无论删除还是取消，都把勾选还原到套用分组前的快照（selBeforeGroup 由 console.js 在 change 时记录）
function restoreGroupSel() {
  if (!selBeforeGroup) return;
  selected = selBeforeGroup; selBeforeGroup = null;
  save(); render();
}
document.getElementById("confirm-yes").addEventListener("click", () => {
  if (!pendingDelete) return;
  if (pendingDelete.kind === "grp") {
    groups = groups.filter((_, i) => i !== pendingDelete.index);
    chrome.storage.local.set({ amsGroups: groups }); renderGroups();
    restoreGroupSel();
  } else {
    templates = templates.filter((_, i) => i !== pendingDelete.index);
    chrome.storage.local.set({ amsTemplates: templates }); renderTemplates();
  }
  closeConfirm();
});
document.getElementById("confirm-no").addEventListener("click", () => {
  cancelConfirm();
});
elConfirm.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.preventDefault(); cancelConfirm(); } });
