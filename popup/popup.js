// popup/popup.js — 切换按钮 + 显示模式设置 + 快捷键展示
async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function send(msg) {
  const tab = await activeTab();
  if (!tab || !tab.id) throw new Error("no-tab");
  return chrome.tabs.sendMessage(tab.id, msg);
}

async function refreshState() {
  try {
    const res = await send({ source: "AMS", cmd: "getState" });
    document.getElementById("think").classList.toggle("active", !!res && res.state === "think");
    document.getElementById("fast").classList.toggle("active", !!res && res.state === "fast");
  } catch (e) {
    document.getElementById("unsupported").style.display = "block";
  }
}

for (const mode of ["think", "fast"]) {
  document.getElementById(mode).addEventListener("click", async () => {
    try {
      await send({ source: "AMS", mode });
      window.close(); // 切换在页面内异步执行，toast 会提示结果
    } catch (e) {
      document.getElementById("unsupported").style.display = "block";
    }
  });
}

chrome.storage.sync.get({ displayMode: "handle" }, (v) => {
  const el = document.querySelector(`input[name=dm][value="${v.displayMode}"]`);
  if (el) el.checked = true;
});
document.querySelectorAll("input[name=dm]").forEach((r) =>
  r.addEventListener("change", () => chrome.storage.sync.set({ displayMode: r.value }))
);

chrome.commands.getAll((cmds) => {
  const div = document.getElementById("keys");
  div.textContent = cmds.map((c) => `${c.description || c.name}: ${c.shortcut || "未设置"}`).join("　") + "　";
  const a = document.createElement("a");
  a.textContent = "改键";
  a.addEventListener("click", () => chrome.tabs.create({ url: "chrome://extensions/shortcuts" }));
  div.append(a);
});

refreshState();
