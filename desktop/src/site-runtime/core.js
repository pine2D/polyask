// desktop/src/site-runtime/core.js — 核心：helpers + 注册表 + runMode + 快捷键消息入口。
// 适配器由 desktop/src/site-runtime/adapters-*.js 注册到 window.__AMS.adapters（preload 的 require 顺序保证其后加载）。
(function () {
  "use strict";

  const t = globalThis.__AMS_I18N__ ? globalThis.__AMS_I18N__.t : globalThis.t;
  function checkDeadline(deadline) { if (deadline && Date.now() >= deadline) throw new Error("timeout"); }
  function tierAction(deadline, action) { checkDeadline(deadline); return action(); }
  async function sleep(ms, deadline) {
    checkDeadline(deadline);
    await new Promise((r) => setTimeout(r, deadline ? Math.min(ms, Math.max(0, deadline - Date.now())) : ms));
    checkDeadline(deadline);
  }

  // 轮询等待：fn 返回真值则返回之，超时返回 null
  async function waitFor(fn, timeout = 3500, step = 120, deadline) {
    const t0 = Date.now();
    for (;;) {
      checkDeadline(deadline);
      let v = null;
      try { v = fn(); } catch (e) { v = null; }
      if (v) return v;
      if (Date.now() - t0 >= timeout) return null;
      await sleep(Math.min(step, Math.max(0, timeout - (Date.now() - t0))), deadline);
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
    // detail:1 拟真（真实点击 detail=1；el.click()/裸构造是 0）——Kimi 新首页按 detail===0 过滤机器人点击（真机 2026-07-21）
    ["pointerdown", "mousedown", "pointerup", "mouseup", "click"].forEach((t) =>
      el.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window, detail: 1, button: 0 }))
    );
    return true;
  }

  function escMenus() {
    for (let i = 0; i < 2; i++) {
      document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    }
  }

  // 用户可见反馈的所有权在 Desktop 外壳（状态通道 + live region），站点视图里不再弹横幅：
  // 九个视图各弹一条硬编码配色、与外壳主题/语言/进度脱节的提示条只会制造噪音。保留函数与调用点，
  // 函数体早退——preload 覆盖 __AMS.toast 拦不住 IIFE 内对局部闭包的调用。
  function toast() {}
  // 视口内可见、面积最大的编辑区（textarea / contenteditable）；找不到返回 null。高度阈值须留余量：
  // Claude 单行编辑器标称 20px，缩放机器上实测 19.99…，贴着实测值的 >=20 会筛掉唯一的真编辑器（2026-08）
  function findComposer() {
    const cands = [...document.querySelectorAll('textarea, [contenteditable="true"]')]
      // ChatGPT 的长回答可变为 Canvas 编辑器；它的面积大于真正的提问框，必须先排除。
      .filter(el => location.hostname !== "chatgpt.com" || !el.closest?.('[data-chatgpt-selection-message-id], [data-turn="assistant"], [data-message-author-role="assistant"]'))
      .map((el) => ({ el, r: el.getBoundingClientRect() }))
      .filter(({ r }) => r.width > 80 && r.height >= 16 &&
        r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth);
    if (!cands.length) return null;
    cands.sort((a, b) => b.r.width * b.r.height - a.r.width * a.r.height);
    return cands[0].el;
  }

  // 可见文本（answer 收集用）：innerText 只取渲染可见内容——textContent 会把站内/第三方扩展注入的
  // 隐藏节点（水印 UUID、翻译克隆等）一并带出，所见即所得必须用 innerText（textContent 仅作兜底）
  function visText(el) { return ((el && (el.innerText != null ? el.innerText : el.textContent)) || "").trim(); }

  // 读输入框当前文本：textarea/input 取 .value，其余优先 innerText 保留段落换行；不折叠词间空格。
  function readText(e) {
    if (!e) return "";
    const v = (e.tagName === "TEXTAREA" || e.tagName === "INPUT") ? (e.value || "") : (e.innerText ?? e.textContent ?? "");
    return v.replace(/\r\n?/g, "\n").trim();
  }
  function promptMatches(el, text) {
    return readText(el) === String(text || "").replace(/\r\n?/g, "\n").trim();
  }

  // 切换成功后把光标放回输入框
  function focusComposer() {
    try { const el = findComposer(); if (el) el.focus(); } catch (e) {}
  }

  // 注入并提交：附件必须先确认；文字按 textarea setter / beforeinput 注入，再走 adapter、按钮或 Enter。
  // 返回 {ok, code?, reason?}，用户文案由 console 按错误码翻译。
  async function submitPromptNow(text, deadline, images, historyToken) {
    let el = findComposer();
    if (!el) return { ok: false, code: "composer_not_found" }; // 失败一律传 code，由 console 端按界面语言翻译
    if (images && images.length) {
      const upload = window.__AMS.uploadImages && await window.__AMS.uploadImages(images, pickAdapter(), el, deadline);
      if (!upload || !upload.ok) return upload || { ok: false, code: "attachment_unsupported" };
      const left = Number(deadline) ? Math.max(0, Number(deadline) - Date.now()) : 3500;
      el = findComposer() || (left ? await waitFor(findComposer, Math.min(3500, left)) : null);
      if (!el) return { ok: false, code: "attachment_timeout" }; // 不返回 composer_not_found，避免 bg 整包重传同一图片
    }
    el.focus();
    if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") {
      const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, "value").set.call(el, text);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    } else {
      // inject 返回 false=交回通用链；抛异常=通用链不安全，直接 inject_failed（Kimi 会 DOM/model 分叉）。
      const a0 = pickAdapter();
      let injected0 = false;
      try { injected0 = !!(a0 && typeof a0.inject === "function" && a0.inject(el, text) !== false); }
      catch (e) { return { ok: false, code: "inject_failed" }; }
      if (injected0) { await sleep(150); } // Lexical 类编辑器异步应用注入，立即读文本会误判 inject_failed
      else {
      // 先全选(替换既有内容)，再用 beforeinput 注入；没进去再退回 execCommand。
      const _before = (el.textContent || "").trim();
      try { const s = getSelection(); s.removeAllRanges(); const rg = document.createRange(); rg.selectNodeContents(el); s.addRange(rg); } catch (e) {}
      el.dispatchEvent(new InputEvent("beforeinput", { inputType: "insertText", data: text, bubbles: true, cancelable: true }));
      await sleep(60);
      const _after = (el.textContent || "").trim();
      if (!(_after && _after !== _before)) { // 受控编辑器多行会重排换行，includes 误判；改判"非空且较注入前有变化"
        let injected = false;
        try { document.execCommand("selectAll", false, null); injected = document.execCommand("insertText", false, text); }
        catch (e) {}
        if (!injected) { el.textContent = text; el.dispatchEvent(new InputEvent("input", { bubbles: true })); }
      }
      }
    }
    // 硬校验本次内容，不能把受控组件回滚的旧非空草稿或部分注入当作成功；保留词间空格，仅统一换行。
    if (!promptMatches(el, text)) return { ok: false, code: "inject_failed" };
    await sleep(250);
    el = findComposer() || el;
    if (!promptMatches(el, text)) return { ok: false, code: "inject_failed" };
    if (deadline && Date.now() >= deadline) return { ok: false, code: "timeout" };
    const a = pickAdapter();
    const confirmUntil = () => images && images.length ? deadline : deadline ? Math.min(deadline, Date.now() + 3000) : 0;
    let watchMessage = false;
    try { watchMessage = !!historyToken && typeof window.__AMS.history?.submitted === "function"
      && !window.__AMS.history.submitted(historyToken); } catch (_) {}
    if (a && typeof a.submit === "function") {
      // 契约：submit 返回 false = 本站发送键此刻未找到/不可用 → 落回下方通用路径（按钮/Enter/校验循环）。
      // 点击成功也要过提交校验：新适配的发送键（div 无 role 等）点了未必生效，不校验就是假成功回归。
      try {
        const before = readText(el);
        if ((await a.submit(el, deadline)) !== false)
          return await confirmSubmitted(before, confirmUntil(), historyToken, watchMessage);
      } catch (e) { return { ok: false, code: e?.message === "inject_failed" ? "inject_failed" : "error", reason: String((e && e.message) || e) }; }
    }
    // 发送键定位在 send.js：纵向锚定输入区，横向择近，排除侧栏里的同名按钮。
    // 每次动作前检查绝对截止时间，防止主进程已报超时后才迟到发送。
    const btn = window.__AMS.sendBtn ? window.__AMS.sendBtn(el) : null;
    if (deadline && Date.now() >= deadline) return { ok: false, code: "timeout" };
    if (!promptMatches(el, text)) return { ok: false, code: "inject_failed" };
    const before = readText(el);
    // 一旦发出提交动作，只读等待确认；不能用 Enter/第二次点击“补发”不确定的提交。
    if (btn && !btn.disabled && btn.getAttribute?.("aria-disabled") !== "true") btn.click();
    else ["keydown", "keypress", "keyup"].forEach((type) => el.dispatchEvent(new KeyboardEvent(type, { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true })));
    return await confirmSubmitted(before, confirmUntil(), historyToken, watchMessage);
  }

  // 本轮新增用户消息是正向证据；输入框变化保留旧兼容，但明确标注证据范围。
  async function confirmSubmitted(before, deadline, historyToken, watchMessage) {
    const end = Number(deadline) || Date.now() + 3000;
    while (Date.now() < end) {
      await sleep(Math.min(200, Math.max(0, end - Date.now())));
      try {
        if (watchMessage && window.__AMS.history?.submitted(historyToken)) {
          window.__AMS.clearUploadReceipt?.(); return { ok: true, submissionEvidence: "message" };
        }
      } catch (_) {}
      const composer = findComposer();
      if (!composer) continue;
      const cur = readText(composer);
      if (!cur || cur !== before) {
        window.__AMS.clearUploadReceipt?.(); return { ok: true, submissionEvidence: "composer" };
      }
    }
    return { ok: false, code: "submit_unconfirmed" };
  }

  // 注册表：适配器由 adapters.js 填充
  const adapters = {};

  function pickAdapter() {
    const h = location.hostname;
    const key = Object.keys(adapters).find((k) => h.includes(k));
    return key ? adapters[key] : null;
  }

  // 动作层只报告是否抛错；真实结果由 tier.js 只读复核。
  async function runModeNow(mode, silent, image, deadline) {
    const a = pickAdapter(), action = image && a && a[mode + "Image"] ? mode + "Image" : mode;
    if (!a || !a[action]) return false;
    // 站点偶发渲染抖动会导致首次失败：静默重试一次，仍失败才报错
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        checkDeadline(deadline);
        escMenus(); // 清掉可能残留的菜单，保证从干净态开始
        await sleep(attempt ? 600 : 150, deadline);
        await a[action](deadline);
        checkDeadline(deadline);
        if (!silent) toast(t(mode === "think" ? "cs_switchedThink" : "cs_switchedFast"), true);
        focusComposer();
        try { document.dispatchEvent(new CustomEvent("ams:switched")); } catch (e) {}
        return true;
      } catch (e) {
        escMenus(); try { console.debug("[PolyAsk] switch:", (e && e.message) || e); } catch (e2) {} if (attempt && !silent) toast(t("cs_switchFailGeneric"), false); // 最后一次失败后也必须收尾，残留菜单会罩住输入框让随后的注入点空；适配器抛的是硬编码中文，只降级进控制台，不进用户可见文案
      }
    }
    return false;
  }

  // 站点模型菜单是共享 UI：快捷键、悬浮按钮与群发交错会互相关菜单/点错项。
  // 所有外部交互串行；群发把「切档 + 提交」放在同一任务里，发送前档位不会被插队改写。
  let interactionChain = Promise.resolve();
  function serializeInteraction(fn) {
    const next = interactionChain.then(fn, fn);
    interactionChain = next.then(() => {}, () => {});
    return next;
  }
  function runMode(mode, silent, deadline = Date.now() + 10000) {
    return serializeInteraction(async () => (await resolveTier(mode, deadline)).outcome !== "unconfirmed");
  }
  function submitPrompt(text, deadline, images) { return serializeInteraction(() => submitPromptNow(text, deadline, images)); }

  // 分卷未加载时只报告未确认，不因动作没有抛错而假报成功。
  function resolveTier(mode, deadline, image) {
    return window.__AMS.resolveTier ? window.__AMS.resolveTier(mode, deadline, image)
      : Promise.resolve({ requested: mode, outcome: "unconfirmed" });
  }

  // 当前档位（同步快速读，不开菜单）；适配器无 state 或读不出时返回 null
  function getState() {
    const a = pickAdapter();
    try { return a && a.state ? a.state() : null; } catch (e) { return null; }
  }

  // 只读健康自检：适配器自带 diagnose() 优先，否则回退为档位可读性
  function diagnose() {
    const a = pickAdapter();
    if (!a) return [{ name: t("cs_siteAdapter"), ok: false, kind: "probe" }];
    if (a.diagnose) { try { return a.diagnose(); } catch (e) { return [{ name: t("cs_diagError"), ok: false, kind: "probe" }]; } }
    return [{ name: t("diag_tierReadable"), ok: getState() != null, kind: "tier" }];
  }

  // 快捷键/弹窗入口：runtime 消息只来自本扩展，无需 origin 校验。
  // 守卫：主世界注入测试时 chrome.runtime.onMessage 不存在，跳过监听不影响其余能力。
  try {
    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (!msg || msg.source !== "AMS") return;
      if (msg.mode === "think" || msg.mode === "fast") runMode(msg.mode, false, Number(msg.deadline) || undefined);
      if (msg.cmd === "getState") { const a = pickAdapter(); sendResponse({ state: getState(), canConfirm: !!(a && a.submitted) }); } if (msg.cmd === "wasSubmitted") { const a = pickAdapter(); let ok = false; try { ok = !!(a && a.submitted && a.submitted(msg.text || "")); } catch (e) {} sendResponse({ supported: !!(a && a.submitted), ok }); }
      if (msg.cmd === "collectAnswer") { // 只读快照：adapter.answer 返回最后一条回答的根节点，通用序列化为 Markdown
        let text = null;
        try {
          const a = pickAdapter();
          const node = a && a.answer ? a.answer() : null;
          text = typeof node === "string" ? node
            : node ? (window.__AMS.toMarkdown ? window.__AMS.toMarkdown(node) : visText(node)) : null;
        } catch (e) {}
        sendResponse({ host: location.hostname, state: getState(), text: text || null });
      }
      if (msg.cmd === "diagnose") sendResponse({ checks: diagnose(), host: location.hostname });
      if (msg.cmd === "submitPrompt") {
        serializeInteraction(async () => {
          try {
            const deadline = Number(msg.deadline) || 0;
            if (deadline && Date.now() >= deadline) return { host: location.hostname, ok: false, code: "timeout" };
            // 新开页面若立即 runMode 会因模型切换器未渲染而切换失败：先等输入框出现
            //（页面交互就绪的代理，切换器此时通常已就位），再切档位、提交。未就绪则返回
            // composer_not_found 可在预算内重试；切档未确认仍提交并保留警示。
            const waitMs = deadline ? Math.max(0, Math.min(4000, deadline - Date.now())) : 4000;
            if (!(await waitFor(() => findComposer(), waitMs))) return { host: location.hostname, ok: false, code: "composer_not_found" };
            if (deadline && Date.now() >= deadline) return { host: location.hostname, ok: false, code: "timeout" };
            let selection, tier = msg.tier, images = msg.images || [];
            const a = pickAdapter(), imageMode = images.length && a && (a.thinkImage || a.fastImage);
            if (imageMode && tier !== "think" && tier !== "fast") tier = getState() || "fast";
            if (tier === "think" || tier === "fast") {
              const tierDeadline = Math.min(deadline || Infinity, Date.now() + 10000);
              selection = await resolveTier(tier, tierDeadline, !!imageMode); await sleep(deadline ? Math.min(200, Math.max(0, deadline - Date.now())) : 200);
            }
            if (deadline && Date.now() >= deadline) return { host: location.hostname, ok: false, code: "timeout", ...(selection ? { selection } : {}) };
            try { window.__AMS.history?.begin(msg.historyToken, msg.text, deadline, { images: images.length }); } catch (_) {}
            const r = await submitPromptNow(msg.text || "", deadline, images, msg.historyToken);
            if (selection) r.selection = selection;
            if (r.ok && selection?.outcome === "unconfirmed") r.code = "tier_unconfirmed"; // 提交成功但档位未确认：console 绿点带警示，不再谎报全绿
            return Object.assign({ host: location.hostname }, r);
          } catch (e) { return { host: location.hostname, ok: false, code: "error", reason: String((e && e.message) || e) }; }
        }).then(sendResponse, (e) => sendResponse({ host: location.hostname, ok: false, code: "error", reason: String((e && e.message) || e) }));
        return true; // 异步 sendResponse
      }
    });
  } catch (e) {}

  window.__AMS = { runMode, runModeAction: runModeNow, pickAdapter, adapters, waitFor, findByText, openMenu, clickEl, sleep, checkDeadline, tierAction, escMenus, toast, getState, diagnose, findComposer, submitPrompt, visText };
})();
