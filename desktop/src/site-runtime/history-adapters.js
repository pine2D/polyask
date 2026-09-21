// 只读轮次配对。定位不到明确的用户消息时不提供历史快照。
(function () {
  "use strict";
  const S = window.__AMS;
  if (!S?.adapters) return;
  const users = {
    "claude.ai": '[data-testid="user-message"]',
    "chatgpt.com": '[data-message-author-role="user"]',
    "gemini.google.com": "user-query",
    "deepseek.com": ".ds-message",
    "doubao.com": "[data-message-id]",
    "qianwen.com": ".question-common-card",
    "kimi.com": ".chat-content-item-user",
    "yuanbao.tencent.com": ".agent-chat__list__item--human",
    "chatglm.cn": ".question-content"
  };
  const key = node => node?.getAttribute?.("data-message-id") || node?.getAttribute?.("data-turn-id") || null;
  for (const [host, selector] of Object.entries(users)) {
    const a = S.adapters[host];
    if (!a || typeof a.answer !== "function") continue;
    a.historyTurn = function () {
      let nodes = [...document.querySelectorAll(selector)];
      if (host === "deepseek.com") nodes = nodes.filter(node => !node.querySelector(".ds-markdown"));
      if (host === "doubao.com") nodes = nodes.filter(node => node.matches('[class*="justify-end"]') || node.querySelector('[class*="justify-end"]'));
      const user = nodes.at(-1);
      if (!user?.isConnected) return null;
      let answer = this.answer();
      // Disconnected/string answers cannot demonstrate their position in the conversation.
      if (!answer?.isConnected || typeof user.compareDocumentPosition !== "function") answer = null;
      if (answer) {
        const order = user.compareDocumentPosition(answer);
        if ((order & 1) || !(order & 4) || user.contains(answer)) answer = null;
      }
      const textNode = host === "kimi.com" ? user.querySelector(".user-content") || user : user;
      return { user, answer, text: textNode.innerText || textNode.textContent || "", userKey: key(user), answerKey: key(answer) };
    };
  }
}());
