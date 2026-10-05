// desktop/src/site-runtime/history-locate.js — 逐次提问副本的定位兜底：第 ② 级语义信号、第 ③ 级问题原文锚点。
// 第 ① 级是 history-adapters.js 的逐站选择器，它找不到用户轮次时才轮到这里；三种结果都必须再过 history.js 的 bind()。
// 定位方法冻结在 begin() 建的 ctx 上（ctx.method）：基线命中哪一级就只用哪一级；基线为空时每次按 ①②③ 顺序试，
// 由 history.js 的 bind() 在首次确立本轮用户时冻结，begin 与后续快照的 userCount 同源，绑定后不换方法。
// 只读同步：不改 DOM、不开菜单、不产文案。汇总复制（core.js collectAnswer）不接这里——它没有 bind() 归属保护。
(function () {
  "use strict";
  const S = window.__AMS;
  if (!S) return;
  // ② 只认明确区分角色的语义属性与组件标签名（不随样式类名改版）；aria 文案随界面语言变，不作角色依据。
  const USER = '[data-message-author-role="user"],[data-author-role="user"],[data-message-role="user"],[data-role="user"],'
    + '[data-author="user"],[data-sender="user"],[data-turn="user"],[data-testid="user-message"],[data-testid="user-query"],user-query,user-message';
  const ASSISTANT = '[data-message-author-role="assistant"],[data-author-role="assistant"],[data-message-role="assistant"],[data-role="assistant"],'
    + '[data-author="assistant"],[data-sender="assistant"],[data-turn="assistant"],[data-testid="assistant-message"],[data-testid="bot-message"],model-response,assistant-message';
  // 排除区：导航、侧栏、页眉页脚、弹窗、输入区、隐藏节点。会话列表多半只有类名可认，
  // 只在它不包住输入框时才排除——整页布局壳的类名里也常带 sidebar。
  // 弹窗库（aria-hidden 包的 hideOthers，Radix 等）在模态期间给弹窗以外的同层节点打 aria-hidden + data-aria-hidden：
  // 豆包「下载电脑版」推广弹窗会这样盖住整个 <main>，一律排除则首问永远绑不上（D1，2026-10-05 Windows）。
  // 但它对原本就 aria-hidden 的节点也照打标记（aria-hidden 1.2.6 源码），标记本身分不出新旧，
  // 所以只豁免包住当前输入框的那一层（真隐藏的区域不会装着正在用的输入框），见 fenced()。
  const HIDDEN = '[aria-hidden="true"]:not([data-aria-hidden])';
  const MODAL_HIDDEN = '[aria-hidden="true"][data-aria-hidden]';
  const HARD = `nav,aside,header,footer,form,dialog,textarea,input,select,script,style,noscript,template,[hidden],${HIDDEN},`
    + '[role="navigation"],[role="banner"],[role="complementary"],[role="dialog"],[role="alertdialog"],[aria-modal="true"],[contenteditable]:not([contenteditable="false"])';
  const LISTS = '[class*="sidebar" i],[class*="side-bar" i],[class*="conversation-list" i],[class*="session-list" i],[class*="history-list" i]';
  const CONTROLS = 'button,[role="button"],[role="toolbar"],[aria-hidden="true"],[hidden],svg,script,style,noscript,template';
  // 操作条常用 div 拼「编辑 / 复制 / 分享」而不用 button（Kimi 用户气泡下的 .segment-user-action-row，2026-10-03 真机）：
  // 按类名词元认（以 action/actions 或 action-row/-bar 等收尾的纯标识符），不算实质内容，否则它会先于真回答被当成回答根。
  // 只认纯标识符词元：Tailwind 任意变体（Claude `[&:has(>[data-reserves-actions-gap])]:pb-md`）与工具类（ChatGPT `px-toolbar`）都不算。
  const ACTION = /^[a-z][a-z0-9]*(?:[_-][a-z0-9]+)*[_-]actions?(?:[_-](?:row|bar|area|group|list|box|wrap|wrapper|container))?$/i;
  const control = el => el.matches(CONTROLS) || (el.getAttribute("class") || "").split(/\s+/).some(token => ACTION.test(token));
  // 读屏专用副本（Gemini 用户气泡里的 h5.cdk-visually-hidden「You said + 原文」，2026-10-03 真机）：不可见，
  // 不参与锚点同文计数，也不进用户文本，否则原文必然「两处同文」、语义级文本也对不上。只认通行的工具类名。
  const SR_ONLY = /^(?:sr-only|visually-hidden|cdk-visually-hidden)$/;
  const srOnly = el => (el.getAttribute("class") || "").split(/\s+/).some(token => SR_ONLY.test(token));
  const THINK = '[class*="think" i],[class*="reason" i],details';
  // 虚拟列表站：回收后又插回的旧节点同样满足 wasInserted，锚点无法区分新旧轮次，一律禁用。
  // DeepSeek 会话区为 ds-virtual-list（2026-10-03 真机），同样禁用。
  const VIRTUAL = /(?:^|\.)(?:doubao\.com|yuanbao\.tencent\.com|deepseek\.com)$/;
  // 未命中时整页 TreeWalker 的最小间隔：MutationObserver 每批变更都会调 historyTurn，命不中（如同文多处）
  // 也不能每批都走一遍整页。绑定后只用缓存节点；插入证据存在 history.js 的 WeakSet 里，节流不丢归属。
  const WALK_MS = 500;
  const norm = text => S.history?.normalize ? S.history.normalize(text)
    : String(text || "").replace(/[​-‍﻿]/g, "").replace(/\s+/g, " ").trim();
  const textOf = node => node?.innerText ?? node?.textContent ?? "";
  // 气泡里的时间戳与操作条不是用户原文：豆包新会话首问绑定后约 2–4 s，用户节点的 message_action_bar 才补插
  // <time>今天 16:16</time>（2026-10-04 Windows 真机），读进来 bind() 就判「原文不符」结束本轮。认 <time> 标签，
  // 以及 class / data-testid 里与 ACTION 同规则的操作条词元（豆包 message_action_bar、Kimi segment-user-action-row）。
  const chrome = el => el.matches("time") || [el.getAttribute("class"), el.getAttribute("data-testid")]
    .some(value => String(value || "").split(/\s+/).some(token => ACTION.test(token)));
  const within = (el, root, test) => { for (let p = el.parentElement; p && p !== root; p = p.parentElement) if (test(p)) return true; return false; };
  // 恰好一个消息正文容器时只读它（豆包 [data-testid="message_text_content"]，① 级 history-adapters.js 同取法）。
  const TEXT_BOX = '[data-testid="message_text_content"]';
  // 用户文本：去掉读屏副本（多在原文前，从前删）与时间戳/操作条（多在原文后，从后删），各按出现位置删一次，不改 DOM。
  function userText(node) {
    const boxes = node?.querySelectorAll?.(TEXT_BOX) || [];
    if (boxes.length === 1) node = boxes[0];
    let text = textOf(node);
    const cut = (el, last) => {
      const part = textOf(el), at = !part ? -1 : last ? text.lastIndexOf(part) : text.indexOf(part);
      if (at >= 0) text = text.slice(0, at) + " " + text.slice(at + part.length);
    };
    for (const el of node?.querySelectorAll?.('[class*="sr-only"],[class*="visually-hidden"]') || []) {
      if (srOnly(el) && !el.parentElement?.closest('[class*="sr-only"],[class*="visually-hidden"]')) cut(el, false);
    }
    // 只删参与渲染的：display:none 的操作条（hover 前隐藏）不在外层 innerText 里，它自己的 innerText 却按规范退回
    // textContent，照删会把原文里同文的一段（问题里的「复制」）删掉。外层本身未渲染时两者都是 textContent，照删。
    const shown = el => typeof el.checkVisibility !== "function" || el.checkVisibility() || !node.checkVisibility();
    for (const el of node?.querySelectorAll?.("time,[class],[data-testid]") || []) {
      if (chrome(el) && !within(el, node, chrome) && !within(el, node, srOnly) && shown(el)) cut(el, true);
    }
    return text;
  }
  // 实例 key：data-message-id / data-turn-key / data-id 这类；data-testid 是组件名不是实例，不算。
  const key = node => {
    for (const attr of node?.attributes || []) if (/^data-(?:[\w-]*-)?(?:id|key)$/i.test(attr.name) && attr.value) return attr.value;
    return null;
  };
  // 最外层：祖先链上没有同组节点（Set 查表，O(n·深度)，不做 n² 次 contains）。
  const outer = nodes => {
    const set = new Set(nodes);
    return nodes.filter(node => { for (let el = node.parentElement; el; el = el.parentElement) if (set.has(el)) return false; return true; });
  };
  const follows = (user, node) => !!(user.compareDocumentPosition(node) & 4) && !user.contains(node) && !node.contains(user);
  // ctx.batch：history.js 在一批 MutationObserver 回调内给的缓存（同步回调内 DOM 不变），②③ 两级共用一次 findComposer。
  const composerOf = (ctx) => {
    const batch = ctx?.batch;
    if (batch && "composer" in batch) return batch.composer;
    let composer = null;
    try { composer = S.findComposer?.() || document.querySelector('textarea, [contenteditable="true"]'); } catch (_) {}
    if (batch) batch.composer = composer;
    return composer;
  };
  // 会话列表类名只在它位于输入框列左右两侧时才排除：智谱的真会话区就叫 conversation-list-outer（与输入框水平重叠、
  // 不包住输入框，2026-10-03 真机），一律排除会把真气泡挡掉，只剩顶栏标题这类回显可认。量不到布局（视口 0×0）时照旧排除。
  const beside = (el, composer) => {
    const a = el.getBoundingClientRect?.(), b = composer?.getBoundingClientRect?.();
    return !(a?.width && b?.width) || a.right <= b.left || a.left >= b.right;
  };
  const fenced = (el, composer) => el.matches(HARD) || srOnly(el) || (el.matches(MODAL_HIDDEN) && !(composer && el.contains(composer)))
    || (el.matches(LISTS) && !(composer && el.contains(composer)) && (!composer || beside(el, composer)));
  function excluded(node, composer) {
    if (composer && node.contains(composer)) return true;
    for (let el = node; el && el !== document.body; el = el.parentElement) if (fenced(el, composer)) return true;
    return false;
  }
  // 有实质内容：跳过按钮、操作条、隐藏与 aria-hidden 子树后仍有非空白文本。遇到第一段文本即返回，不序列化整棵子树。
  function meaningful(el) {
    if (control(el)) return false;
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, { acceptNode: node =>
      node.nodeType === 1 ? (control(node) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_SKIP) : NodeFilter.FILTER_ACCEPT });
    for (let node = walker.nextNode(); node; node = walker.nextNode()) if (node.nodeValue.trim()) return true;
    return false;
  }
  // 正文块：根内恰好一个不在思考段里的 markdown 块时取它，否则取整个根（多块拆分的站宁可多带也不只取末块）。
  // 只有思考段里有 markdown、正文块还没出现时返回 null：整个根会把推理过程当正文写进副本（Kimi 2026-10-03 真机）。
  function content(root) {
    const all = [...root.querySelectorAll('[class*="markdown" i]')];
    const blocks = outer(all.filter(node => {
      const thinking = node.closest(THINK);
      return !thinking || thinking === root || !root.contains(thinking);
    }));
    if (!blocks.length && all.length) return null;
    return blocks.length === 1 ? blocks[0] : root;
  }
  function turn(user, userCount, root, locate, text = userText(user)) {
    return { user, userCount, text, userKey: key(user), answer: root && content(root),
      answerRoot: root, answerKey: root ? key(root) : null, locate };
  }

  // ② 语义信号：最外层用户节点计数、取末条；回答取其后最外层的末个助手节点。
  function semantic(ctx) {
    const composer = composerOf(ctx);
    const users = outer([...document.querySelectorAll(USER)].filter(node => !excluded(node, composer)));
    const user = users.at(-1);
    if (!user?.isConnected) return null;
    // 先用廉价的文档序筛掉末条用户之前的节点，再做逐层上溯的排除区判定（长会话里前者通常只剩一两个）。
    const roots = outer([...document.querySelectorAll(ASSISTANT)].filter(node => follows(user, node)).filter(node => !excluded(node, composer)));
    return turn(user, users.length, roots.at(-1) || null, "semantic");
  }

  // 锚点只认与输入框同处主内容区的同文：输入框在 main/[role=main] 里时同文也须在其内；量得到布局时还须与输入框水平重叠
  // （会话列表、最近记录在输入框左右两侧，类名未必带 sidebar，也未必包在 nav/aside 里）。只按反证剔除：
  // 站点视图未挂载时视口为 0×0、量不到宽度，那时不能因此丢掉锚点，仍由排除区与唯一同文把关。
  function column(el, composer) {
    const main = composer.closest?.('main,[role="main"]');
    if (main && !main.contains(el)) return false;
    const a = el.getBoundingClientRect?.(), b = composer.getBoundingClientRect?.();
    return !(a?.width && b?.width && (a.right <= b.left || a.left >= b.right));
  }
  // ③ 找问题原文所在节点：排除区整棵跳过；整段问题恰好一处同文才算命中。多行问题若没有整段同文的文本节点，
  // 要求每一行命中次数与它在问题里出现的次数相同，取包含全部行的最小公共祖先。整段与分行同时存在 = 歧义。
  function find(raw, whole, composer) {
    const lines = String(raw).split(/\r\n?|\n/).map(norm).filter(Boolean);
    const hits = [], parts = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, { acceptNode: node =>
      node.nodeType === 1 ? (fenced(node, composer) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_SKIP)
        // 输入框祖先上的直挂文本（输入区提示、草稿回显）不算。
        : node.parentElement?.contains(composer) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT });
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const value = norm(node.nodeValue);
      if (!value) continue;
      if (value === whole) { if (column(node.parentElement, composer)) hits.push(node); }
      else if (lines.length > 1 && lines.includes(value) && column(node.parentElement, composer)) parts.push(node);
    }
    let user = null;
    if (hits.length) {
      if (hits.length > 1 || parts.length) return null;
      user = hits[0].parentElement;
    } else if (lines.length > 1) {
      for (const line of new Set(lines)) {
        if (parts.filter(node => norm(node.nodeValue) === line).length !== lines.filter(value => value === line).length) return null;
      }
      user = parts[0]?.parentElement;
      while (user && !parts.every(node => user.contains(node))) user = user.parentElement;
    }
    if (!user || user === document.body || user.contains(composer)) return null;
    return norm(userText(user)) === whole ? user : null;
  }
  // 回答根：自用户节点逐层上溯（不越过与输入框同属的那层），取最低一层「其后有实质内容的兄弟」。
  // 它之后、或更高层之后还有实质内容 = 已有后续轮次或结构无法判定，userCount 记 2，交给 bind() 停止。
  // 正文就是问题原文的兄弟是回显（智谱顶栏标题旁的测量副本 span.measure-span，2026-10-03 真机），不是回答。
  function follow(user, composer, whole) {
    let root = null;
    for (let level = user; level.parentElement && level.parentElement !== document.body && !level.parentElement.contains(composer); level = level.parentElement) {
      for (let next = level.nextElementSibling; next; next = next.nextElementSibling) {
        if (excluded(next, composer) || !meaningful(next) || norm(userText(next)) === whole) continue;
        if (root) return { root, extra: true };
        root = next;
      }
    }
    return { root, extra: false };
  }
  function anchor(ctx) {
    if (!ctx?.anchor || VIRTUAL.test(location.hostname)) return null;
    const whole = norm(ctx.text), composer = composerOf(ctx);
    if (!whole || !composer) return null;
    const cache = ctx.cache || (ctx.cache = { user: null, raw: "", text: "", walked: 0 });
    // 缓存节点仍连接且文本未变就直接复用（比 textContent，不在热路径上反复触发 innerText 布局）；
    // 只有它脱离文档（乐观节点被替换）或文本变了才重新走整页。ctx.fresh（history.js 读正文的那次调用）不用缓存、不节流：
    // 缓存不复核唯一性，智谱顶栏标题先于真气泡唯一命中、2 ms 后出现第二处同文，靠缓存撑着的错绑会一直读到标题改名。
    if (ctx.fresh || !(cache.user?.isConnected && cache.user.textContent === cache.raw)) {
      cache.user = null;
      if (!ctx.fresh && Date.now() - cache.walked < WALK_MS) return null;
      cache.walked = Date.now();
      if (!(cache.user = find(ctx.text, whole, composer))) return null;
      cache.raw = cache.user.textContent; cache.text = userText(cache.user);
    }
    const { root, extra } = follow(cache.user, composer, whole);
    return turn(cache.user, extra ? 2 : 1, root, "anchor", cache.text);
  }

  S.historyLocate = {
    // ctx.method 已冻结时只跑那一级；未冻结时 ② 后 ③（③ 还要 begin() 判定的 ctx.anchor）。拿不准返回 null。
    locate(ctx) {
      const method = ctx?.method;
      if (method === "semantic") return semantic(ctx);
      if (method === "anchor") return anchor(ctx);
      if (method) return null;
      return semantic(ctx) || anchor(ctx);
    }
  };
}());
