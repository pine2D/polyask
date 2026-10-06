// Mermaid 源码提取：九站共用，语言标记优先；无标记只认确定语法头，不从 SVG 猜源码。
(function () {
  "use strict";
  const S = window.__AMS;
  if (!S) return;
  const tokens = (el) => String(el.getAttribute("class") || "").split(/\s+/);
  const marked = (el) => tokens(el).includes("language-mermaid") ||
    ["data-language", "data-lang", "lang"].some((name) => el.getAttribute(name)?.toLowerCase() === "mermaid");
  const preview = (el) => el.getAttribute("data-mermaid") === "true" || el.getAttribute("data-code-block-preview-pane") === "mermaid" ||
    [...el.attributes || []].some((a) => /-mermaid-preview$/.test(a.name)) ||
    tokens(el).some((c) => /(?:^|[-_/])mermaid(?:Box)?(?:$|[-_])/i.test(c));
  const widget = (el) => el.tagName === "CODE-BLOCK" || tokens(el).some((c) => /^(?:md-)?code-block$/.test(c));
  const signature = (text) => /^(?:(?:flowchart|graph)\s+(?:TB|TD|BT|RL|LR)|sequenceDiagram|classDiagram|stateDiagram-v2|erDiagram)[ \t]*(?:\n|$)/.test(text.trimStart());
  function source(el) {
    if (el.tagName === "PRE") return el.querySelector("code") || el;
    return el.querySelector("pre code,pre,code[data-language=mermaid],code.language-mermaid");
  }
  // 通用双页签图表卡：只认 role + aria-controls 的配对，且当前节点须是两页签的共同容器。
  // 可取隐藏的语言标记源码；正文祖先和无关联的隐藏代码不会被整块吸收。
  function tabbedSource(el) {
    const selector = '.language-mermaid,[data-language="mermaid"],[data-lang="mermaid"],[lang="mermaid"]';
    const panes = [...el.querySelectorAll?.('[role="tabpanel"]') || []].filter(p => p.id && p.querySelector(selector));
    if (panes.length !== 1) return null;
    const pane = panes[0], tab = [...el.querySelectorAll('[role="tab"][aria-controls]')]
      .find(t => t.getAttribute('aria-controls').split(/\s+/).includes(pane.id));
    const list = tab?.closest('[role="tablist"]');
    if (!list) return null;
    let card = pane.parentElement;
    while (card && !card.contains(list)) card = card.parentElement;
    if (card !== el) return null;
    const language = pane.querySelector(selector);
    return source(language) || language;
  }
  S.mdDiagram = function (el, codeText, backtickFence, pendingLang) {
    const cls = tokens(el), tag = el.tagName.toUpperCase();
    let root = tabbedSource(el);
    if (!root) {
      // 标准代码形态；language-mermaid / data-language 可以位于 pre、code 或其专用容器。
      if (marked(el) || (tag === "PRE" && cls.includes("mermaid"))) root = source(el) || el;
      else if (tag === "PRE" && el.querySelector("code.language-mermaid,code[data-language=mermaid]")) root = source(el);
      // 已核验的预览卡片：外壳可见，但源码区 display:none。仅取标记子树，隐藏水印等仍跳过。
      else if (cls.includes("code-no-artifacts")) {
        const language = el.querySelector('.language-mermaid,[data-language="mermaid"],[lang="mermaid"]');
        if (language) root = source(language);
        else if (!el.querySelector(".mermaid-render")) return null;
      } else if (preview(el) || (widget(el) && el.querySelector("svg.mermaid-svg"))) root = source(el);
      else if ((tag === "PRE" || widget(el)) && !pendingLang) {
        root = source(el);
        const metadata = root && [root, el].some((n) => /language-[\w+-]+/.test(n.getAttribute("class") || "") ||
          ["data-language", "data-lang", "lang"].some((a) => !!n.getAttribute(a)));
        const ft = S.mdHead.firstTextNode(el), head = ft && root && !root.contains(ft) ? ft.nodeValue.trim() : "";
        if (!root || metadata || /^[A-Za-z0-9+#.-]{1,20}$/.test(head) || !signature(codeText(root))) return null;
      } else return null;
    }
    const body = root ? codeText(root).replace(/\n+$/, "") : "";
    const fence = backtickFence(body, 3);
    return fence + "mermaid\n" + body + "\n" + fence + "\n\n";
  };
})();
