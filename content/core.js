// content/core.js — 核心：helpers + 注册表 + runMode + 快捷键消息入口。
// 适配器由 content/adapters.js 注册到 window.__AMS.adapters（manifest js 顺序保证其后加载）。
(function () {
  "use strict";

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // 轮询等待：fn 返回真值则返回之，超时返回 null
  async function waitFor(fn, timeout = 3500, step = 120) {
    const t0 = Date.now();
    for (;;) {
      let v = null;
      try { v = fn(); } catch (e) { v = null; }
      if (v) return v;
      if (Date.now() - t0 > timeout) return null;
      await sleep(step);
    }
  }

  // 在节点集合里按正则找命中文本的元素
  function findByText(selector, re, root) {
    const nodes = [...(root || document).querySelectorAll(selector)];
    return nodes.find((n) => re.test((n.textContent || "").trim())) || null;
  }

  // Radix / Angular-Material 菜单靠 pointer 序列开，单纯 click 可能不开
  function openMenu(el) {
    if (!el) return;
    ["pointerdown", "mousedown", "pointerup", "mouseup", "click"].forEach((t) =>
      el.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window }))
    );
  }

  function clickEl(el) {
    if (!el) return false;
    ["pointerdown", "mousedown", "pointerup", "mouseup", "click"].forEach((t) =>
      el.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window }))
    );
    return true;
  }

  function escMenus() {
    for (let i = 0; i < 2; i++) {
      document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    }
  }

  // 提示条：顶部居中（胶囊在 top:8px，toast 放 48px 不遮挡）
  function toast(msg, ok) {
    try {
      const d = document.createElement("div");
      d.textContent = msg;
      d.style.cssText =
        "position:fixed;z-index:2147483647;top:48px;left:50%;transform:translateX(-50%);" +
        "max-width:90%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding:8px 12px;" +
        "border-radius:8px;font:13px/1.4 sans-serif;color:#fff;box-shadow:0 2px 8px rgba(0,0,0,.25);" +
        "background:" + (ok ? "#16a34a" : "#dc2626");
      document.body.appendChild(d);
      setTimeout(() => d.remove(), 2500);
    } catch (e) {}
  }

  // 切换成功后把光标放回输入框：取视口内可见、面积最大的编辑区
  function focusComposer() {
    try {
      const cands = [...document.querySelectorAll('textarea, [contenteditable="true"]')]
        .map((el) => ({ el, r: el.getBoundingClientRect() }))
        .filter(({ r }) => r.width > 80 && r.height > 20 &&
          r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth);
      if (!cands.length) return;
      cands.sort((a, b) => b.r.width * b.r.height - a.r.width * a.r.height);
      cands[0].el.focus();
    } catch (e) {}
  }

  // 注册表：适配器由 adapters.js 填充
  const adapters = {};

  function pickAdapter() {
    const h = location.hostname;
    const key = Object.keys(adapters).find((k) => h.includes(k));
    return key ? adapters[key] : null;
  }

  async function runMode(mode) {
    const a = pickAdapter();
    if (!a || !a[mode]) return;
    // 站点偶发渲染抖动会导致首次失败：静默重试一次，仍失败才报错
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        escMenus(); // 清掉可能残留的菜单，保证从干净态开始
        await sleep(attempt ? 600 : 150);
        await a[mode]();
        toast(mode === "think" ? "已切到：深度思考" : "已切到：快速模型", true);
        focusComposer();
        try { document.dispatchEvent(new CustomEvent("ams:switched")); } catch (e) {}
        return;
      } catch (e) {
        if (attempt) toast("切换失败：" + (e && e.message ? e.message : e), false);
      }
    }
  }

  // 当前档位（同步快速读，不开菜单）；适配器无 state 或读不出时返回 null
  function getState() {
    const a = pickAdapter();
    try { return a && a.state ? a.state() : null; } catch (e) { return null; }
  }

  // 只读健康自检：适配器自带 diagnose() 优先，否则回退为档位可读性
  function diagnose() {
    const a = pickAdapter();
    if (!a) return [{ name: "站点适配器", ok: false }];
    if (a.diagnose) { try { return a.diagnose(); } catch (e) { return [{ name: "diagnose 异常", ok: false }]; } }
    return [{ name: "档位可读", ok: getState() != null }];
  }

  // 快捷键/弹窗入口：runtime 消息只来自本扩展，无需 origin 校验。
  // 守卫：主世界注入测试时 chrome.runtime.onMessage 不存在，跳过监听不影响其余能力。
  try {
    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (!msg || msg.source !== "AMS") return;
      if (msg.mode === "think" || msg.mode === "fast") runMode(msg.mode);
      if (msg.cmd === "getState") sendResponse({ state: getState() });
      if (msg.cmd === "diagnose") sendResponse({ checks: diagnose(), host: location.hostname });
    });
  } catch (e) {}

  window.__AMS = { runMode, adapters, waitFor, findByText, openMenu, clickEl, sleep, escMenus, toast, getState, diagnose };
})();
