// desktop/src/site-runtime/generation.js — Desktop 只读回答状态探测；保守误漏，不以旧回答冒充本轮完成。
(function () {
  "use strict";

  const S = window.__AMS;
  if (!S || !S.adapters) return;

  const stopSelectors = {
    // chat-input-stop 是 Claude 生产包里的 testid 常量（同族的 chat-input / chat-input-send /
    // chat-input-attach 均已真机核实）；stop-button 是 ChatGPT 的形状，Claude 上零命中，
    // 保留它只为万一回归。aria-label 由 react-intl 产出、随界面语言变，只能当兜底不能当锚点。
    "claude.ai": '[data-testid="chat-input-stop"],[data-testid="stop-button"],button[aria-label*="stop response" i],button[aria-label*="停止回答"]',
    // 中文界面停止键只有 aria-label「停止」、没有 testid（2026-10-04 Windows 真机 zh-CN）；精确匹配，不吃「停止朗读」这类同前缀控件。
    "chatgpt.com": 'button[aria-label="Stop"],button[aria-label="停止"],[data-testid="stop-button"],button[aria-label*="stop answering" i],button[aria-label*="stop generating" i],button[aria-label*="停止回答"]',
    "gemini.google.com": 'button[aria-label*="stop response" i],button[aria-label*="停止回答"]',
    // DeepSeek 无停止标签：限定主按钮内已实测的方形 SVG，不能把同类发送箭头当停止键。
    "deepseek.com": '.ds-button--primary:has(svg path[d^="M2 4.88C2"]),[aria-label*="stop" i],[aria-label*="停止"]',
    "doubao.com": '[class*="break-btn-"],#flow-end-msg-stop,[aria-label*="stop" i],[aria-label*="停止"]',
    "qianwen.com": '[aria-label*="stop" i],[aria-label*="停止"]',
    "kimi.com": '.send-button-container.stop,.stop-button,[class*="stop-button"],[aria-label*="stop" i],[aria-label*="停止"]',
    // 中文界面为「停止回答」，类名 SendButton_sendStop__* 与界面语言无关（2026-10-03 真机）。
    "yuanbao.tencent.com": '#yuanbao-send-btn[aria-label="Stop Answering"],#yuanbao-send-btn[aria-label="停止回答"],#yuanbao-send-btn[class*="sendStop"],[aria-label="Stop"],[aria-label="停止"]',
    "chatglm.cn": '.enter.searching,.stop-button,[aria-label*="stop" i],[aria-label*="停止"]',
  };

  function visibleNearComposer(el) {
    if (!el || typeof el.getBoundingClientRect !== "function") return false;
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4 || r.bottom <= 0 || r.top >= innerHeight || r.right <= 0 || r.left >= innerWidth) return false;
    const composer = S.findComposer && S.findComposer();
    if (!composer || typeof composer.getBoundingClientRect !== "function") return true;
    const c = composer.getBoundingClientRect();
    return r.bottom >= c.top - 360 && r.top <= c.bottom + 160;
  }

  const stopVisible = (selector) => [...document.querySelectorAll(selector)].some(visibleNearComposer);
  for (const [host, selector] of Object.entries(stopSelectors)) {
    const adapter = S.adapters[host];
    if (!adapter || typeof adapter.generation === "function") continue;
    adapter.generation = function () {
      try {
        if (!location.hostname.includes(host)) return null;
        const stop = stopVisible(selector);
        if (latch.selector === selector) latch.note(stop);
        if (stop) return "generating";
        if (typeof this.answer !== "function") return null;
        return this.answer() ? "complete" : "idle";
      } catch (e) {
        return null;
      }
    };
  }

  // 停止键锁存：主进程每 900ms 探测一次，短回答（ChatGPT、DeepSeek）的停止键可能整段落在两次探测之间，
  // 主进程从没见过「generating」就永远不收「complete」，只能超时报 generation_unconfirmed（2026-10-04 真机）。
  // 这里在本次提交起用 MutationObserver 补采样：亲眼见过停止键出现（提交时已在的不算，须先见它消失）才锁存，
  // 探测随后读到「complete」时改报 complete_observed——正向证据，不是「文本不长了」。每次提交重新武装。
  const LATCH_MS = 15 * 60_000 + 45_000; // 与 history.js 的观察窗同长：主进程收口（15 分钟）后不再采样
  const SAMPLE_MS = 100; // 采样节流：流式渲染每秒数十批变更，停止键至少亮一帧以上，100ms 间隔不会漏
  // baseline：武装时 answer() 指向的节点（上一轮回答，首轮为 null）。锁存只证明「停止键出现过」，证明不了本轮出了新回答——
  // 请求失败、没插入新回答节点时 answer() 仍是上一轮那个，这时不升级，交回主进程原有的「亲眼见过 generating」规则。
  const latch = { selector: null, blocked: false, seen: false, baseline: null, observer: null, timer: null, until: 0, last: 0, pending: null,
    disarm() {
      this.observer?.disconnect(); this.observer = null;
      if (this.timer) clearTimeout(this.timer);
      if (this.pending) clearTimeout(this.pending);
      this.timer = this.pending = null;
    },
    note(visible) {
      if (!this.selector || this.seen || Date.now() >= this.until) return;
      if (this.blocked) { if (!visible) this.blocked = false; return; }
      if (visible) { this.seen = true; this.disarm(); }
    },
    sample() {
      if (!this.selector || this.seen || Date.now() >= this.until) return;
      this.last = Date.now();
      this.note(stopVisible(this.selector));
    },
    throttled() {
      if (this.pending) return;
      const wait = Math.max(0, this.last + SAMPLE_MS - Date.now());
      if (!wait) { this.sample(); return; }
      this.pending = setTimeout(() => { this.pending = null; this.sample(); }, wait);
    }
  };
  S.armGeneration = function () {
    try {
      latch.disarm();
      const entry = Object.entries(stopSelectors).find(([host]) => location.hostname.includes(host));
      Object.assign(latch, { selector: entry ? entry[1] : null, seen: false, blocked: false, baseline: null, last: 0, until: Date.now() + LATCH_MS });
      if (!latch.selector) return;
      const adapter = S.adapters[entry[0]];
      try { latch.baseline = adapter && typeof adapter.answer === "function" ? adapter.answer() || null : null; } catch (e) { latch.baseline = null; }
      latch.blocked = stopVisible(latch.selector);
      if (typeof MutationObserver === "function") {
        latch.observer = new MutationObserver(() => latch.throttled());
        latch.observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true,
          attributeFilter: ["class", "aria-label", "disabled", "data-testid", "id"] });
      }
      latch.timer = setTimeout(() => latch.disarm(), LATCH_MS);
    } catch (e) { latch.disarm(); latch.selector = null; }
  };
  // 外壳的回答状态探测入口（preload readGeneration）：只在读到 complete 时叠加锁存，其余原样返回。
  S.generationProbe = function () {
    const entry = Object.entries(S.adapters).find(([host]) => location.hostname.includes(host));
    const adapter = entry && entry[1];
    if (!adapter || typeof adapter.generation !== "function") return null;
    const state = adapter.generation();
    if (state !== "complete" || !latch.seen || Date.now() >= latch.until) return state;
    let current = null;
    try { current = typeof adapter.answer === "function" ? adapter.answer() : null; } catch (e) { current = null; }
    const fresh = !!current && current !== latch.baseline && current.isConnected !== false;
    return fresh ? "complete_observed" : state;
  };
}());
