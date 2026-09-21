// 只读轮次配对。定位不到明确的用户消息时不提供历史快照。
(function () {
  "use strict";
  const S = window.__AMS;
  if (!S?.adapters) return;
  const users = {
    "claude.ai": '[data-testid="user-message"]',
    "chatgpt.com": '[data-turn="user"], [data-message-author-role="user"]',
    "gemini.google.com": "user-query",
    "deepseek.com": ".ds-message",
    "doubao.com": "[data-message-id]",
    "qianwen.com": ".question-text-card",
    "kimi.com": ".chat-content-item-user",
    "yuanbao.tencent.com": ".agent-chat__list__item--human",
    "chatglm.cn": ".conversation.question .question-txt"
  };
  const answerRoots = {
    "claude.ai": ".font-claude-response", "chatgpt.com": '[data-turn="assistant"]',
    "gemini.google.com": "model-response", "deepseek.com": ".ds-message",
    "doubao.com": "[data-message-id]", "qianwen.com": ".answer-common-card",
    "kimi.com": ".chat-content-item-assistant", "yuanbao.tencent.com": ".agent-chat__list__item--ai",
    "chatglm.cn": ".answer-content"
  };
  const key = node => node?.getAttribute?.("data-message-id") || node?.getAttribute?.("data-turn-id") || null;
  for (const [host, selector] of Object.entries(users)) {
    const a = S.adapters[host];
    if (!a || typeof a.answer !== "function") continue;
    a.historyTurn = function () {
      let nodes = [...document.querySelectorAll(selector)];
      if (host === "deepseek.com") nodes = nodes.filter(node => node.querySelector(".ds-collapsible-text") && !node.querySelector(".ds-markdown"));
      if (host === "doubao.com") nodes = nodes.filter(node => node.matches('[class*="justify-end"]') || node.querySelector('[class*="justify-end"]'));
      nodes = nodes.filter(node => !nodes.some(parent => parent !== node && parent.contains(node)));
      const user = nodes.at(-1);
      if (!user?.isConnected) return { user: null, userCount: 0 };
      let answer = this.answer();
      // Disconnected/string answers cannot demonstrate their position in the conversation.
      if (!answer?.isConnected || typeof user.compareDocumentPosition !== "function") answer = null;
      if (answer) {
        const order = user.compareDocumentPosition(answer);
        if ((order & 1) || !(order & 4) || user.contains(answer)) answer = null;
      }
      const textNode = host === "kimi.com" ? user.querySelector(".user-content") || user : user;
      const text = host === "gemini.google.com"
        ? [...user.querySelectorAll(".query-text-line")].map(node => node.innerText || node.textContent || "").join("\n")
        : textNode.innerText || textNode.textContent || "";
      const answerRoot = answer?.closest?.(answerRoots[host]) || answer;
      return { user, userCount: nodes.length, answer, answerRoot, text, userKey: key(user), answerKey: key(answerRoot) };
    };
  }
}());
