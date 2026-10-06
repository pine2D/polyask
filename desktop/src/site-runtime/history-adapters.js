// 只读轮次配对。定位不到明确的用户消息时不提供历史快照。
// 本文件是第 ① 级（逐站选择器）；找不到用户轮次时交给 history-locate.js 的 ②③ 级，方法由 history.js 冻结在 ctx.method 上。
(function () {
  "use strict";
  const S = window.__AMS;
  if (!S?.adapters) return;
  const users = {
    "claude.ai": '[data-testid="user-message"]',
    "chatgpt.com": '[data-turn="user"], [data-message-author-role="user"], [data-user-message-bubble]',
    "gemini.google.com": "user-query",
    "deepseek.com": ".ds-message",
    "doubao.com": "[data-message-id]",
    "qianwen.com": ".question-text-card",
    "kimi.com": ".chat-content-item-user",
    "yuanbao.tencent.com": ".agent-chat__list__item--human",
    "chatglm.cn": ".conversation.question .question-txt"
  };
  const answerRoots = {
    "claude.ai": '[data-testid="assistant-message"], .font-claude-response', "chatgpt.com": '[data-turn="assistant"], [data-chatgpt-selection-message-id]',
    "gemini.google.com": "model-response", "deepseek.com": ".ds-message",
    "doubao.com": "[data-message-id]", "qianwen.com": ".answer-common-card",
    "kimi.com": ".chat-content-item-assistant", "yuanbao.tencent.com": ".agent-chat__list__item--ai",
    "chatglm.cn": ".answer-content"
  };
  const directKey = node => node?.getAttribute?.("data-message-id") || node?.getAttribute?.("data-turn-id") || node?.getAttribute?.("data-chatgpt-selection-message-id") || node?.getAttribute?.("data-content-search-unit-key") || node?.getAttribute?.("data-turn-key") || null;
  // 真实脱敏 DOM：Claude/ChatGPT 的轮次 key、DeepSeek 的虚拟项 key 在气泡祖先上。只认逐消息属性，绝不用会话/列表 id。
  const wrapperAttr = () => /(^|\.)deepseek\.com$/.test(location.hostname) ? "data-virtual-list-item-key"
    : location.hostname === "claude.ai" ? "data-turn-key" : location.hostname === "chatgpt.com" ? "data-content-search-unit-key" : null;
  function key(node) {
    const attr = wrapperAttr();
    if (attr) for (let el = node, depth = 0; el && depth < 8; el = el.parentElement, depth++) {
      const value = el.getAttribute?.(attr); if (value) return value;
    }
    return directKey(node);
  }
  // 列表回收和追加可能在同一 MutationObserver 批里发生。previousSibling 记录的是插入瞬间的次序：
  // 新用户槽必须紧接 begin 时已知的助手槽，且有不同的消息 key。整页 hydration/滚回旧槽不能作证。
  function witnessedAppend(baseline, records, turn) {
    if (!/(^|\.)deepseek\.com$/.test(location.hostname) || !baseline?.userKey || !turn?.userKey || turn.userKey === baseline.userKey) return false;
    const previous = baseline.answerRoot?.closest?.("[data-virtual-list-item-key]");
    return !!previous && !!baseline.answerKey && key(previous) === baseline.answerKey && records.some(record => record.previousSibling === previous
      && [...record.addedNodes].some(node => node === turn.user || node.contains?.(turn.user)));
  }
  S.historyIdentity = { key, witnessedAppend };
  for (const [host, selector] of Object.entries(users)) {
    const a = S.adapters[host];
    if (!a || typeof a.answer !== "function") continue;
    // ctx 由 history.js begin() 建立：ctx.method 冻结后只跑那一级；未冻结时每次都按 ①②③ 依次试。这里只定位不冻结——
    // 冻结只发生在基线命中（begin）或 bind() 首次确立本轮用户时，否则一次没被采纳的锚点命中会把 ① 永久挤出本轮。
    // 无 ctx（巡检探针、采集脚本）时 ① 后 ②，不走需要问题原文的 ③。diag.js 用 { method: "selector" } 只看 ①。
    a.historyTurn = function (ctx) {
      const method = ctx?.method;
      let turn = method && method !== "selector" ? null : selectorTurn.call(this);
      if (turn?.user) turn.locate = "selector";
      else if (method !== "selector") turn = S.historyLocate?.locate(ctx) || turn;
      return turn?.user ? turn : { user: null, userCount: 0 };
    };
    function selectorTurn() {
      let nodes = [...document.querySelectorAll(selector)], userCount, previousUserKey;
      nodes = nodes.filter(node => !nodes.some(parent => parent !== node && parent.contains(node)));
      if (host === "deepseek.com") nodes = nodes.filter(node => node.querySelector(".ds-collapsible-text") && !node.querySelector(".ds-markdown"));
      if (host === "doubao.com") {
        // One image prompt renders as consecutive image-only bubbles then its text.
        // An assistant response or a text bubble ends the group: never merge follow-ups.
        let attachment = false; userCount = 0;
        const turns = [];
        nodes = nodes.filter(node => {
          const isUser = node.matches('[class*="justify-end"]') || node.querySelector('[class*="justify-end"]');
          if (!isUser) { attachment = false; return false; }
          if (!attachment) { userCount++; turns.push(node); }
          else turns[turns.length - 1] = node;
          attachment = !(node.innerText || node.textContent || "").trim() && !!node.querySelector("img");
          return true;
        });
        previousUserKey = key(turns.at(-2));
      }
      const user = nodes.at(-1);
      if (!user?.isConnected) return { user: null, userCount: 0 };
      previousUserKey ??= key(nodes.at(-2));
      let answer = this.answer();
      // Disconnected/string answers cannot demonstrate their position in the conversation.
      if (!answer?.isConnected || typeof user.compareDocumentPosition !== "function") answer = null;
      if (answer) {
        const order = user.compareDocumentPosition(answer);
        if ((order & 1) || !(order & 4) || user.contains(answer)) answer = null;
      }
      // 豆包：只读唯一的消息正文容器，气泡里的时间戳/操作条/状态位不算原文（与 history-locate.js 的第 ② 级同取法）。
      const doubaoText = host === "doubao.com" ? user.querySelectorAll?.('[data-testid="message_text_content"]') || [] : [];
      const textNode = host === "kimi.com" ? user.querySelector(".user-content") || user
        : host === "chatgpt.com" ? user.querySelector('[data-user-message-bubble]') || user
        : doubaoText.length === 1 ? doubaoText[0] : user;
      const text = host === "gemini.google.com"
        ? [...user.querySelectorAll(".query-text-line")].map(node => node.innerText || node.textContent || "").join("\n")
        : textNode.innerText || textNode.textContent || "";
      // ChatGPT adds its selection-message wrapper after streaming has begun.
      // The surrounding search unit exists from the first token and stays stable.
      const follows = node => node?.isConnected && !user.contains(node) && (user.compareDocumentPosition(node) & 4) && !(user.compareDocumentPosition(node) & 1);
      const answerRoot = (host === "chatgpt.com" && answer?.closest?.('[data-content-search-unit-key]'))
        || answer?.closest?.(answerRoots[host]) || answer
        || [...document.querySelectorAll(answerRoots[host])].filter(follows).at(-1) || null;
      // 用户轮次定位与正文定位分开。Claude 主标记漂移时只在已配对的助手根里找正文；不降级 userCount 来源。
      if (!answer && host === "claude.ai" && answerRoot) {
        answer = [...answerRoot.querySelectorAll('.standard-markdown')].filter(node => !node.closest('details,[class*="think" i],[class*="reason" i]')).at(-1) || null;
      }
      return { user, userCount: userCount ?? nodes.length, previousUserKey, answer, answerRoot, text, userKey: key(user), answerKey: key(answerRoot) };
    }
  }
}());
