// desktop/src/site-runtime/md-head.js — md.js 的前置卷（按 300 行上限拆出，preload 先于 md.js 注入）：节点剔除规则 drop()、
// 可见文字片段，以及代码块前头部条（语言名 / 复制键）的判定。只读同步，不改 DOM，挂到 __AMS.mdHead。
(function () {
  "use strict";
  const S = window.__AMS;
  if (!S) return;
  const SKIP = new Set(["BUTTON", "SVG", "STYLE", "SCRIPT", "NOSCRIPT", "SELECT", "TEXTAREA", "AUDIO", "VIDEO"]);
  // 千问长文写作卡（aiWritingCard：标题 +「创建于 MM-DD HH:mm」，点开是画布）是可点卡片外壳 data-card-highlight-target，
  // 挂在回答正文之后，曾让副本以「标题\n\n创建于 10-04 20:50」收尾（2026-10-04 Windows 真机）；卡前后的正文不在外壳内，照常保留。
  // 外壳外的「在对话中输出」按钮（output-in-chat > label）同属卡片界面件，一律剔除。长文默认写进画布时回答可能只有卡片：
  // 这时只剔除外壳里的创建时间（sub-title / description），标题作一行正文保留——整卡删掉会让副本为空、这一问永远存不下来。
  const CARD = "[data-card-highlight-target]", CARD_UI = '[class*="output-in-chat"]', CARD_META = /(?:^|\s)(?:sub-title|description)-/;
  // 回答（.answer-common-card）里在卡片外壳、卡片按钮与思考段之外还有字：卡片只是正文的附件，整卡剔除。找不到回答根时照旧整卡剔除。
  function cardHasCompany(card) {
    const root = card.closest?.(".answer-common-card");
    if (!root) return true;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let t = walker.nextNode(); t; t = walker.nextNode()) {
      if (!t.nodeValue.trim() || card.contains(t)) continue;
      const host = t.parentElement;
      if (!host?.closest(`${CARD_UI},[class*="thinkingContent"]`)) return true;
    }
    return false;
  }
  // 只用 getAttribute 判定（md-runtime 的轻量 DOM 桩没有 matches/closest），命中卡片相关类名时才向上找。
  function cardChrome(el) {
    const cls = String(el.getAttribute("class") || "");
    if (cls.includes("output-in-chat")) return true;
    if (el.getAttribute("data-card-highlight-target") !== null) return cardHasCompany(el);
    return CARD_META.test(cls) && !!el.parentElement?.closest?.(CARD);
  }
  const drop = (el) => {
    if (SKIP.has(el.tagName.toUpperCase()) || el.getAttribute("aria-hidden") === "true" || el.getAttribute("role") === "button"
      || cardChrome(el)) return true;
    const cs = getComputedStyle(el);
    return cs.display === "none" || cs.visibility === "hidden";
  };
  function visibleParts(n) {
    const parts = [];
    (function walk(node) {
      for (const c of node.childNodes) {
        if (c.nodeType === 3) { const v = c.nodeValue.replace(/\s+/g, " ").trim(); if (v) parts.push(v); }
        else if (c.nodeType === 1 && !drop(c)) walk(c);
      }
    })(n);
    return parts;
  }
  // 下一个"有实质内容"的兄弟是代码块？跳过纯空文本兄弟（Claude 的 opacity-0 复制按钮容器
  // drop() 剔不掉但 innerText 为空）；PRE 常被再包一层透明 DIV（Claude overflow-x-auto /
  // Kimi syntax-highlighter），故含 PRE 的 DIV 也算命中。真机取证 2026-07-11。
  function preAhead(x) {
    let s = x.nextElementSibling;
    while (s && s.tagName.toUpperCase() !== "PRE" && !(s.innerText || "").trim()) s = s.nextElementSibling;
    if (!s) return false;
    const t = s.tagName.toUpperCase();
    return t === "PRE" || (t === "DIV" && !!s.querySelector("pre"));
  }
  // 语言头只能是「整块就是那个词」：自身可见文本（剔除 drop 件与 cursor:pointer 的复制/下载操作件）恰好等于该词，
  // 且没有块级语义后代。智谱回答是 div > [div(markdown-body > ul), div(pre)]，装列表的透明 div 首个文本「Red」
  // 曾被当成语言名，整张列表被吞掉（2026-10-04 Windows 真机）。
  const BLOCKISH = /^(?:UL|OL|LI|P|TABLE|PRE|BLOCKQUOTE|H[1-6])$/;
  // 头部条的可见文本（剔除操作件），含块级语义后代时返回 null；token 为语言名（无语言名时传 ""）。
  // 另带 full（操作件文字也算上）与 control（确有操作件：按钮/svg/role=button、从该层起才 pointer 的非链接节点、copy 类名、带 lang 类名的 p）。
  function headText(x, token) {
    let text = "", full = "", control = false, block = false;
    // cursor 会继承：只剔除「从这一层起才变成 pointer」的子树（操作件本身），整条头部可点时不误剔语言名。
    (function walk(node, pointer) {
      for (const c of node.childNodes) {
        if (block) return;
        if (c.nodeType === 3) { text += c.nodeValue; full += c.nodeValue; continue; }
        if (c.nodeType !== 1) continue;
        const tag = c.tagName.toUpperCase(), cls = String(c.getAttribute("class") || "");
        if (/^(?:BUTTON|SVG)$/.test(tag) || c.getAttribute("role") === "button" || (tag !== "A" && /(?:^|[\s_-])copy/i.test(cls))) control = true;
        if (drop(c)) continue;
        if (BLOCKISH.test(tag)) {
          // 智谱头部条的语言名本身是 <p class="language">python</p>（2026-10-04 Linux 真机）：带 lang 类名、文本恰为该词的段落是语言名，不是正文。
          if (tag === "P" && /lang/i.test(cls) && (c.textContent || "").trim() === token) { text += token; full += token; control = true; continue; }
          block = true; return;
        }
        const own = getComputedStyle(c).cursor === "pointer";
        // 链接在 Chromium UA 样式里默认就是 pointer：只含链接的段落不算有操作件（文字记进 full，由调用方判断）。
        if (own && !pointer) { if (tag !== "A") control = true; full += visibleParts(c).join(" "); continue; }
        walk(c, own);
      }
    })(x, getComputedStyle(x).cursor === "pointer");
    const norm = (v) => v.replace(/\s+/g, " ").trim();
    return block ? null : { text: norm(text), full: norm(full), control };
  }
  // 操作件不一定能靠 cursor 认出（整条头部可点、复制字样放在非 pointer 的 span 里）：语言名之后只剩已知的操作件字样时仍算语言头，
  // 免得「python复制」漏成段落；剩下的是别的文字（散文）就不吸收。
  function langHead(x, token) {
    const head = headText(x, token), rest = head && head.text;
    return head !== null && (rest === token || (rest.startsWith(token) && CHROME.test(rest.slice(token.length).replace(/\s+/g, ""))));
  }
  // 没有语言名的头部条（智谱 p.language 为空 + 复制键，2026-10-04 Windows 真机）：确有操作件、连操作件文字在内只剩操作件字样或空白、
  // 且不带图片，整条不进副本，否则「复制」与围栏粘成一行「复制  ```」。div 段落「运行」、只含链接的段落没有操作件，照常是正文。
  function chromeHead(x) {
    const head = headText(x, "");
    return !!head && head.control && (!head.full || CHROME.test(head.full.replace(/\s+/g, ""))) && !x.querySelector("img");
  }
  const CHROME = /^(?:copy|copied|code|download|run|edit|preview|expand|collapse|wrap|复制|已复制|代码|下载|运行|编辑|预览|展开|收起|折叠|换行)+$/i;
  // 首个非空文本节点（头部条内常有纯空白文本节点垫在语言名前，真机实证：Kimi）
  function firstTextNode(root) {
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let ft = w.nextNode();
    while (ft && !ft.nodeValue.trim()) ft = w.nextNode();
    return ft;
  }
  S.mdHead = { drop, visibleParts, preAhead, langHead, chromeHead, firstTextNode };
})();
