// popup/popup.js — 切换按钮 + 显示模式设置 + 快捷键展示
applyI18n(); // i18n.js 已在 head 载入并从 localStorage 镜像同步了语言，立即本地化静态文案
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
    // 非 AI 站点是常态：中性提示 + 禁用两个档位按钮（否则看似可点、点了才失败）
    document.getElementById("unsupported").style.display = "block";
    document.getElementById("think").disabled = true;
    document.getElementById("fast").disabled = true;
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

chrome.storage.sync.get({ amsLang: "auto" }, (v) => {
  const el = document.querySelector(`input[name=lang][value="${v.amsLang}"]`);
  if (el) el.checked = true;
});
document.querySelectorAll("input[name=lang]").forEach((r) =>
  r.addEventListener("change", () => chrome.storage.sync.set({ amsLang: r.value }))
);

chrome.storage.sync.get({ displayMode: "handle" }, (v) => {
  const el = document.querySelector(`input[name=dm][value="${v.displayMode}"]`);
  if (el) el.checked = true;
});
document.querySelectorAll("input[name=dm]").forEach((r) =>
  r.addEventListener("change", () => chrome.storage.sync.set({ displayMode: r.value }))
);

// 控制台主题（console + compose 共用，theme.js 据此应用）
chrome.storage.sync.get({ amsTheme: "auto" }, (v) => {
  const el = document.querySelector(`input[name=theme][value="${v.amsTheme}"]`);
  if (el) el.checked = true;
});
document.querySelectorAll("input[name=theme]").forEach((r) =>
  r.addEventListener("change", () => chrome.storage.sync.set({ amsTheme: r.value }))
);

document.getElementById("diag").addEventListener("click", async () => {
  const out = document.getElementById("diagout");
  try {
    const res = await send({ source: "AMS", cmd: "diagnose" });
    out.textContent = "";
    const checks = (res && res.checks) || [];
    for (const c of checks) {
      const row = document.createElement("div");
      const mark = document.createElement("span");
      mark.className = "ck " + (c.ok ? "ok" : "bad"); // SVG 标记，不用 ✓/✗ 字形
      row.append(mark, document.createTextNode(c.name));
      row.style.color = c.ok ? "#16a34a" : "#dc2626";
      out.append(row);
    }
    if (checks.some((c) => !c.ok)) {
      const tip = document.createElement("div");
      tip.textContent = t("pop_diagStale");
      tip.className = "hint"; // 用变量色，暗色下保持可读
      out.append(tip);
    }
  } catch (e) { out.textContent = t("pop_diagUnsupported"); }
});

function buildKeys() {
  chrome.commands.getAll((cmds) => {
    const div = document.getElementById("keys");
    div.textContent = "";
    // 每条快捷键一行（曾用全角空格连成一段流文本，扫读性差）：左描述右 <kbd> 键位
    cmds.filter((c) => !c.name.startsWith("_")).forEach((c) => {
      const row = document.createElement("div");
      row.className = "keyrow";
      const label = document.createElement("span");
      label.textContent = c.description || c.name;
      const kbd = document.createElement("kbd");
      kbd.textContent = c.shortcut || t("pop_shortcutUnset");
      row.append(label, kbd);
      div.append(row);
    });
    const a = document.createElement("a");
    a.textContent = t("pop_rebind");
    a.addEventListener("click", () => chrome.tabs.create({ url: "chrome://extensions/shortcuts" }));
    div.append(a);
  });
}
buildKeys();
document.addEventListener("i18n:changed", buildKeys);

document.getElementById("open-console").addEventListener("click", async () => {
  // 带上当前站 host：console 首次使用（无勾选历史）时预勾该站，打通"正看着这个站想群发"的路径
  let host = null;
  try { const tab = await activeTab(); host = tab && tab.url ? new URL(tab.url).hostname : null; } catch (e) {}
  chrome.runtime.sendMessage({ source: "AMS_CONSOLE", action: "openConsole", host });
  window.close();
});

chrome.storage.local.get({ amsAutoRaise: true }, (v) => {
  document.getElementById("autoraise").checked = v.amsAutoRaise !== false;
});
document.getElementById("autoraise").addEventListener("change", (e) =>
  chrome.storage.local.set({ amsAutoRaise: e.target.checked })
);

refreshState();
