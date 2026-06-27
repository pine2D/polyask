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

  // 视口内可见、面积最大的编辑区（textarea / contenteditable）；找不到返回 null
  function findComposer() {
    const cands = [...document.querySelectorAll('textarea, [contenteditable="true"]')]
      .map((el) => ({ el, r: el.getBoundingClientRect() }))
      .filter(({ r }) => r.width > 80 && r.height > 20 &&
        r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth);
    if (!cands.length) return null;
    cands.sort((a, b) => b.r.width * b.r.height - a.r.width * a.r.height);
    return cands[0].el;
  }

  // 切换成功后把光标放回输入框
  function focusComposer() {
    try { const el = findComposer(); if (el) el.focus(); } catch (e) {}
  }

  // 把 text 注入输入框并提交。textarea/input 用原生 value setter；contenteditable 用合成
  // beforeinput（受控编辑器 Lexical/ProseMirror/Slate 无视 execCommand 的 DOM 写入，却处理
  // beforeinput），失败退回 execCommand。提交：优先 adapter.submit(el)，否则原生点发送键，
  // 无按钮再发 Enter。返回 {ok,reason?}。
  async function submitPrompt(text) {
    const el = findComposer();
    if (!el) return { ok: false, reason: "输入框未找到" };
    el.focus();
    if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") {
      const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, "value").set.call(el, text);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    } else {
      // 先全选(替换既有内容)，再用 beforeinput 注入；没进去再退回 execCommand。
      const _before = (el.textContent || "").trim();
      try { const s = getSelection(); s.removeAllRanges(); const rg = document.createRange(); rg.selectNodeContents(el); s.addRange(rg); } catch (e) {}
      el.dispatchEvent(new InputEvent("beforeinput", { inputType: "insertText", data: text, bubbles: true, cancelable: true }));
      await sleep(60);
      const _after = (el.textContent || "").trim();
      if (!(_after && _after !== _before)) { // 受控编辑器多行会重排换行，includes 误判；改判"非空且较注入前有变化"
        try { document.execCommand("selectAll", false, null); document.execCommand("insertText", false, text); }
        catch (e) { el.textContent = text; el.dispatchEvent(new InputEvent("input", { bubbles: true })); }
      }
    }
    await sleep(250);
    const a = pickAdapter();
    if (a && typeof a.submit === "function") {
      try { await a.submit(el); return { ok: true }; } catch (e) { return { ok: false, reason: String((e && e.message) || e) }; }
    }
    // 通用提交：优先原生点击发送按钮（最稳，国产站拒合成事件，且避免对受控编辑器发 Enter 产生多余换行）；
    // !disabled 防误触（空输入时按钮多为禁用）。无可用按钮再退回合成 Enter（适配靠 Enter 提交的 textarea）。
    const sendBtn = () => document.querySelector('button[data-testid*="send" i], button[aria-label*="send" i], button[aria-label*="发送"]');
    let btn = sendBtn();
    if (btn && !btn.disabled) { btn.click(); await sleep(200); return { ok: true }; }
    const _txtBefore = (el.textContent || el.value || "").trim();
    ["keydown", "keypress", "keyup"].forEach((t) =>
      el.dispatchEvent(new KeyboardEvent(t, { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true })));
    await sleep(150);
    btn = sendBtn();
    if (btn && !btn.disabled) btn.click(); // Enter 没发出去且按钮可用 → 原生点
    await sleep(200);
    // 校验：真发出去编辑器会清空；仍有原文 → 判失败，不再假成功（Kimi/元宝/chatglm 无标签发送键存疑路径）
    const _txtAfter = (el.textContent || el.value || "").trim();
    if (_txtAfter && _txtAfter === _txtBefore) return { ok: false, reason: "提交未确认" };
    return { ok: true };
  }

  // 注册表：适配器由 adapters.js 填充
  const adapters = {};

  function pickAdapter() {
    const h = location.hostname;
    const key = Object.keys(adapters).find((k) => h.includes(k));
    return key ? adapters[key] : null;
  }

  // silent=true 时不弹 toast、只返回是否成功（供 switchTier 静默重试）。
  async function runMode(mode, silent) {
    const a = pickAdapter();
    if (!a || !a[mode]) return false;
    // 站点偶发渲染抖动会导致首次失败：静默重试一次，仍失败才报错
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        escMenus(); // 清掉可能残留的菜单，保证从干净态开始
        await sleep(attempt ? 600 : 150);
        await a[mode]();
        if (!silent) toast(t(mode === "think" ? "cs_switchedThink" : "cs_switchedFast"), true);
        focusComposer();
        try { document.dispatchEvent(new CustomEvent("ams:switched")); } catch (e) {}
        return true;
      } catch (e) {
        if (attempt && !silent) toast(t("cs_switchFail", (e && e.message ? e.message : e)), false);
      }
    }
    return false;
  }

  // 群发场景专用：切档位并用 state() 验证真的生效。新开页面切换器渲染晚于输入框，
  // 旧逻辑"runMode 没抛错就算切了"会误判；这里静默重试 runMode 直到 state() 确认目标档，
  // 或超时按当前档发送（不丢提问）。state 不可读的站点：连续两次未报错即视为已尽力。
  async function switchTier(mode, deadlineMs = 10000) {
    const okMsg = t(mode === "think" ? "cs_switchedThink" : "cs_switchedFast");
    const t0 = Date.now();
    let nullTries = 0;
    for (;;) {
      if (getState() === mode) { toast(okMsg, true); return true; }   // 已在目标档（含 state 滞后后追上）
      const switched = await runMode(mode, true);                     // 静默尝试切换
      await sleep(350);
      if (getState() === mode) { toast(okMsg, true); return true; }   // 验证已切到
      if (switched && getState() == null && ++nullTries >= 2) { toast(okMsg, true); return true; }
      if (Date.now() - t0 > deadlineMs) { toast(t("cs_switchUnstable"), false); return false; }
      await sleep(switched ? 400 : 700); // 切到了短等 state 追上；没切到多等页面加载出切换器
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
    if (!a) return [{ name: t("cs_siteAdapter"), ok: false }];
    if (a.diagnose) { try { return a.diagnose(); } catch (e) { return [{ name: t("cs_diagError"), ok: false }]; } }
    return [{ name: t("diag_tierReadable"), ok: getState() != null }];
  }

  // 快捷键/弹窗入口：runtime 消息只来自本扩展，无需 origin 校验。
  // 守卫：主世界注入测试时 chrome.runtime.onMessage 不存在，跳过监听不影响其余能力。
  try {
    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (!msg || msg.source !== "AMS") return;
      if (msg.mode === "think" || msg.mode === "fast") runMode(msg.mode);
      if (msg.cmd === "getState") sendResponse({ state: getState() });
      if (msg.cmd === "diagnose") sendResponse({ checks: diagnose(), host: location.hostname });
      if (msg.cmd === "submitPrompt") {
        (async () => {
          try {
            // 新开页面若立即 runMode 会因模型切换器未渲染而切换失败：先等输入框出现
            //（页面交互就绪的代理，切换器此时通常已就位），再切档位、提交。未就绪则返回
            //「输入框未找到」让 background(sendAll) 轮询重试，杜绝"切换失败仍直接提交"。
            if (!(await waitFor(() => findComposer(), 4000))) {
              sendResponse({ host: location.hostname, ok: false, reason: "输入框未找到" }); return;
            }
            if (msg.tier === "think" || msg.tier === "fast") { await switchTier(msg.tier); await sleep(200); }
            const r = await submitPrompt(msg.text || "");
            sendResponse(Object.assign({ host: location.hostname }, r));
          } catch (e) { sendResponse({ host: location.hostname, ok: false, reason: String((e && e.message) || e) }); }
        })();
        return true; // 异步 sendResponse
      }
    });
  } catch (e) {}

  window.__AMS = { runMode, adapters, waitFor, findByText, openMenu, clickEl, sleep, escMenus, toast, getState, diagnose, findComposer, submitPrompt };
})();
