// console/compose.js — 伴侣编辑窗口（Task 5 最小骨架；Task 6 补双向同步与发送）
const elText = document.getElementById("ch-text");
chrome.storage.local.get("amsConsole", (o) => {
  const c = (o && o.amsConsole) || {};
  if (c.prompt) elText.value = c.prompt;
  elText.focus();
});
document.getElementById("ch-close").addEventListener("click", () => window.close());
