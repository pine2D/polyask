// desktop/src/site-runtime/read-commands.js — 只读命令回包：wasSubmitted / collectAnswer / diagnose。
// core.js 的 handleCommand 委托给 readCommand。同步读取可直接回包，返回 true 时 preload 会等待异步回包。
(function () {
  "use strict";
  const S = window.__AMS;
  if (!S) return;
  const UNSUPPORTED = Object.freeze({ supported: false, ok: false });

  // rAF 在预算内回调 = 页面在出帧。被遮挡后跨文档导航的视图会一直不出帧（rAF=0），而 visibilityState 仍是 visible、
  // 定时器照跑（2026-10-04 Linux/Windows 真机）；这时 React 不提交更新，DOM 读到的「末条不是本次内容」不可信。
  function painting(ms) {
    return new Promise((resolve) => {
      if (!(ms > 0) || typeof requestAnimationFrame !== "function") { resolve(false); return; }
      const timer = setTimeout(() => resolve(false), ms);
      requestAnimationFrame(() => { clearTimeout(timer); resolve(true); });
    });
  }

  // 只读确认（CLAUDE.md「提交不确定 ≠ 可以重发」）：{supported:true, ok:false} 是唯一会触发自动重发的组合，只能由
  // 「适配器同步返回 false、页面在出帧、没有进行中的视图过渡」产生。适配器抛错或返回非布尔 = 不支持（fail-closed）；
  // 视图过渡卡住时 DOM 不更新（Kimi 过渡挂 3 分钟以上、submitted() 始终 false 而服务端已建会话，Windows 真机），同样不支持。
  // 主进程单次探测只给 300ms（broadcast.ts CONFIRM_PROBE_MS），出帧探测留 50ms 回包余量，预算不足即判不支持。
  function wasSubmitted(msg, respond) {
    const a = S.pickAdapter && S.pickAdapter();
    if (!a || typeof a.submitted !== "function") { respond(UNSUPPORTED); return false; }
    const deadline = Number(msg.deadline) || 0;
    const budget = Math.min(300, (deadline ? deadline - Date.now() : 300) - 50);
    painting(budget).then((paints) => {
      let seen;
      try { seen = a.submitted(String(msg.text || "")); } catch (_) { seen = undefined; }
      if (seen === true) { respond({ supported: true, ok: true }); return; }
      let transition = true;
      try { transition = document.activeViewTransition != null; } catch (_) {}
      respond(seen === false && paints && !transition ? { supported: true, ok: false } : UNSUPPORTED);
    }, () => respond(UNSUPPORTED));
    return true;
  }

  // 只读快照：adapter.answer 返回最后一条回答的根节点，通用序列化为 Markdown。
  function collectAnswer(respond) {
    let text = null;
    try {
      const a = S.pickAdapter();
      const node = a && a.answer ? a.answer() : null;
      text = typeof node === "string" ? node : node ? (S.toMarkdown ? S.toMarkdown(node) : S.visText(node)) : null;
    } catch (e) {}
    respond({ host: location.hostname, state: S.getState(), text: text || null });
  }

  S.readCommand = function (msg, respond) {
    if (msg.cmd === "wasSubmitted") return wasSubmitted(msg, respond);
    if (msg.cmd === "collectAnswer") collectAnswer(respond);
    if (msg.cmd === "diagnose") respond({ checks: S.diagnose(), host: location.hostname });
    return false;
  };
})();
