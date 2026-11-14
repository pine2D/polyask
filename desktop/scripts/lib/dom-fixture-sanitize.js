// desktop/scripts/lib/dom-fixture-sanitize.js — 离线 DOM fixture 脱敏器（仓库公开，宁可多删）。
// 两处复用同一份源码：Node 端（jsdom 文档，供测试与扫描门禁 require）；CDP 端由
// capture-dom-fixture.mjs 包进 `(() => { const module = { exports: {} }; <源码>; ... })()` 在页面里求值，
// 因此这里**不得引用 document/window 全局**，只经 root.ownerDocument 取环境，也不得改动活页面
// （只读遍历、手工拼串，不 clone、不 setAttribute）。
// 规则：标签名保留；属性走白名单；其余 data-* 只留键、值换成本 fixture 内稳定的 id-N（同值同占位，
// 保住 key 相等语义）；aria-label 换 label-N；文本一律换占位，仅按长度档保留粗略篇幅；提交的问题原文
// （逐字相等的文本节点）换成调用方给的 token，供原文锚点测试使用。
(function (root, factory) {
  if (typeof module === "object" && module && module.exports) module.exports = factory();
  else root.__polyaskDomFixtureSanitize = factory();
}(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  // 原样保留（值另有格式校验）的属性；扫描门禁与脱敏器共用这一张表。
  const KEEP_ATTRS = [
    "class", "id", "role", "aria-hidden", "aria-expanded", "aria-checked", "aria-selected",
    "aria-pressed", "aria-disabled", "aria-haspopup", "type", "disabled",
    "data-testid", "data-message-author-role", "data-turn", "contenteditable", "hidden"
  ];
  const CONTROL_TYPES = ["button", "submit", "reset", "file", "checkbox", "radio", "range", "text", "search"];
  const HASPOPUP_VALUES = ["true", "false", "menu", "listbox", "dialog", "tree", "grid"];
  // data-* 中值有语义、原样保留的键（仍要过 SEMANTIC_VALUE 格式校验，不合格照样换占位）。
  // 清单与 site-runtime 选择器里按值匹配的 data-* 对齐（含第 ② 级语义表）；漏了回放就会对真站零命中（ChatGPT 2026-10-03 采集）。
  const SEMANTIC_DATA = ["data-testid", "data-message-author-role", "data-turn", "data-conversation-role", "data-markdown-text-style",
    "data-message-role", "data-author-role", "data-role", "data-author", "data-sender"];
  const ROLE_VALUES = ["user", "assistant", "system", "model", "human", "ai", "bot", "tool"];
  const DATA_ROLE_VALUES = [...ROLE_VALUES, "icon", "visible-capsule", "measure-capsule", "measure-overflow-trigger"];
  const PROSE_NO_ID_TAGS = ["h1", "h2", "h3", "h4", "h5", "h6", "p", "li", "pre", "code", "blockquote", "a", "td", "th"];
  const ROUTE_SEGMENTS = ["", "a", "agent", "alltoolsdetail", "app", "c", "chat", "chats", "conversation", "conversations",
    "g", "home", "i", "main", "naQivTmsDa", "new", "p", "s", "search", "share", "t", "thread", "threads"];
  // 期望标记：采集时由隔离上下文的生产 historyTurn() 定出的节点，回放测试据此对账。
  const EXPECT_ATTR = "data-polyask-expect";
  const EXPECT_TOKENS = ["user", "answer", "answer-root"];
  // 整棵子树丢弃（不留标签）：脚本、样式、外部嵌入、元数据。
  const DROP_TAGS = ["script", "style", "noscript", "template", "link", "meta", "base", "iframe", "frame", "object", "embed"];
  // 保留标签但丢弃全部子节点：svg path 数据可能是站点指纹，正文不需要。
  const EMPTY_TAGS = ["svg"];
  const VOID_TAGS = ["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"];
  const TESTID_VALUE = /^[a-z][a-z0-9_-]{1,47}$/;
  const PROMPT_TOKEN = /^[A-Z][A-Z0-9_]{2,39}$/;
  const FILLER = "lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua";
  const FILLER_WORDS = FILLER.split(" ");

  // 敏感串规则（扫描门禁同源）：任何一条命中即视为泄露。正则只描述形状，不做白名单豁免。
  const SENSITIVE = [
    // 不能写成裸「file:」：Tailwind 的 file: 变体类名很常见。
    ["url", /\b(?:https?|wss?|ftp|file):\/\/|\bblob:|\bdata:[a-z]+\/[a-z0-9.+-]+[;,]|(?:^|[^:\w])\/\/[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}|\bwww\./i],
    ["email", /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/],
    ["phone", /\d(?:[ -]?\d){10,}/],
    ["uuid", /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i],
    ["hex", /[0-9a-f]{24,}/i],
    ["jwt", /eyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]*/],
    // 前缀后必须紧跟各家真实分隔符：裸前缀会误伤 Claude 的 skill-arg-hint-sr 这类类名（2026-10-03 真机采集）。
    ["token", /\b(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{8,}|\bsk-[A-Za-z0-9_-]{16,}|\b(?:ghp|gho|ghs|ghu|github_pat)_[A-Za-z0-9_]{10,}|\bxox[abpr]-[A-Za-z0-9-]{10,}|\bAKIA[0-9A-Z]{12,}|\bAIza[0-9A-Za-z_-]{20,}|\bbearer\s+[A-Za-z0-9._~+/-]{10,}/i],
    ["cookie", /\b(?:__Host-|__Secure-)[A-Za-z0-9_.-]+\s*=|\b(?:session_?id|csrftoken|xsrf[-_]?token|auth[-_]?token|access[-_]?token|refresh[-_]?token|id[-_]?token)\s*=\s*[^\s;"']{6,}/i],
    ["local_path", /(?:^|[\s"'=>(,])(?:\/Users\/[A-Za-z0-9._-]+|\/home\/[A-Za-z0-9._-]+|[A-Za-z]:\\Users\\[A-Za-z0-9._-]+)/]
  ];
  // base64 形：≥32 位、且同时含数字/大写/小写（全小写连字符的 Tailwind 长类名不算）。
  const BASE64_RUN = /[A-Za-z0-9+/_-]{32,}={0,2}/g;
  function findSensitive(text) {
    const value = String(text == null ? "" : text);
    const hits = [];
    for (const [name, re] of SENSITIVE) if (re.test(value)) hits.push(name);
    for (const m of value.match(BASE64_RUN) || []) {
      if (/\d/.test(m) && /[A-Z]/.test(m) && /[a-z]/.test(m)) { hits.push("base64"); break; }
    }
    return hits;
  }

  // id 只留看起来是人写的语义名（yuanbao-send-btn 之类）；React/Radix 生成的 :r1a:、长 hash 一律丢弃。
  function isSafeId(value) {
    return /^[A-Za-z][A-Za-z0-9_-]{1,39}$/.test(value) && !/\d{3,}/.test(value)
      && !/(?=[0-9a-f]*\d)[0-9a-f]{8,}/i.test(value) && !findSensitive(value).length;
  }
  function isSafeDataAttr(name) {
    return /^data-[a-z0-9_-]{1,48}$/.test(name) && !findSensitive(name).length
      && (/^data-v-[0-9a-f]{6,10}$/.test(name) || (!/\d{5,}/.test(name) && !/(?=[0-9a-f]*\d)[0-9a-f]{8,}/.test(name)));
  }
  // 类名逐个过：代码块语言后缀归一（仅保留 language-mermaid），非 ASCII、URL/长 id、引号尖括号一律丢弃。
  function safeClass(value) {
    return String(value || "").split(/\s+/).map((tok) => /^(?:language|lang|hljs)-/i.test(tok)
      ? (/^language-mermaid$/i.test(tok) ? "language-mermaid" : "language-code") : tok)
      .filter((token) => token && token.length <= 120 && /^[\x21-\x7e]+$/.test(token)
        && !/["'<>`\\]|url\(/i.test(token) && !findSensitive(token).length).join(" ");
  }
  function semanticDataOk(name, value) {
    if (/^id-\d{1,5}$/.test(value)) return true;
    if (name === "data-testid") return TESTID_VALUE.test(value) && !findSensitive(value).length;
    if (name === "data-markdown-text-style") return value === "assistant-message" || value === "user-message";
    if (name === "data-role") return DATA_ROLE_VALUES.includes(value);
    return ROLE_VALUES.includes(value);
  }
  function attrValueOk(name, value) {
    // class 逐 token 复核 safeClass 的判据（扫描门禁拿到的是实体解码后的值，编码绕不过去）。
    if (name === "class") return safeClass(value) === String(value).split(/\s+/).filter(Boolean).join(" ");
    if (name === "id") return isSafeId(value);
    if (name === "role") return /^[a-z]{1,24}(?: [a-z]{1,24})*$/.test(value);
    if (name === "aria-hidden" || name === "aria-expanded" || name === "aria-selected" || name === "aria-disabled") {
      return value === "true" || value === "false";
    }
    if (name === "aria-checked" || name === "aria-pressed") return value === "true" || value === "false" || value === "mixed";
    if (name === "aria-haspopup") return HASPOPUP_VALUES.includes(value);
    if (name === "type") return CONTROL_TYPES.includes(value);
    if (name === "contenteditable") return ["", "true", "false", "plaintext-only"].includes(value);
    if (name === "hidden" || name === "disabled") return value === "";
    if (name === EXPECT_ATTR) return value.split(" ").every((token) => EXPECT_TOKENS.includes(token));
    if (name === "aria-label") return /^label-\d{1,5}$/.test(value);
    if (SEMANTIC_DATA.includes(name)) return semanticDataOk(name, value);
    if (isSafeDataAttr(name)) return value === "" || value === "true" || value === "false" || /^id-\d{1,5}$/.test(value);
    return false;
  }

  function isPromptText(value, token) {
    const lines = String(value).split("\n");
    if (lines.length === 1) return lines[0] === token || (PROMPT_TOKEN.test(token) && new RegExp(`^${token}-L[1-9]\\d{0,3}$`).test(lines[0]));
    return lines.every((line, i) => line === `${token}-L${i + 1}`);
  }

  function isFillerText(value) {
    const words = String(value).split(" ");
    return words.every((word, i) => FILLER_WORDS.includes(word)
      || (i === words.length - 1 && /^[a-z]+$/.test(word) && FILLER_WORDS.some((item) => item.startsWith(word))));
  }

  function sanitizeRoute(href) {
    const url = new URL(href);
    const ids = new Map();
    const id = (value) => { if (!ids.has(value)) ids.set(value, `id-${ids.size + 1}`); return ids.get(value); };
    let out = url.pathname.split("/").map((seg) => ROUTE_SEGMENTS.includes(seg) ? seg : id(seg)).join("/") || "/";
    const cid = url.searchParams.get("cid");
    if (cid) out += `?cid=${id(cid)}`;
    return out;
  }

  function isSanitizedRoute(value) {
    if (typeof value !== "string" || value.length > 120) return false;
    const m = /^(\/[^?#]*)(?:\?cid=id-\d{1,5})?$/.exec(value);
    return !!m && m[1].split("/").every((seg) => ROUTE_SEGMENTS.includes(seg) || /^id-\d{1,5}$/.test(seg));
  }

  const escapeText = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const escapeAttr = (s) => escapeText(s).replace(/"/g, "&quot;");
  const normalize = (s) => String(s || "").replace(/[​-‍﻿]/g, "").replace(/\s+/g, " ").trim();
  // 长度档：只保留「几个字 / 一句 / 一段 / 长段」这一级信息，不泄露确切长度。
  function filler(length) {
    const target = length <= 4 ? 4 : length <= 16 ? 12 : length <= 64 ? 40 : length <= 256 ? 160 : 480;
    let out = "";
    while (out.length < target) out += (out ? " " : "") + FILLER;
    return out.slice(0, target).trim();
  }

  function sanitizeDomFixture(root, options) {
    const opts = options || {};
    if (!root || root.nodeType !== 1) throw new Error("fixture_root_missing");
    const token = opts.promptToken || "POLYASK_PROMPT";
    if (!PROMPT_TOKEN.test(token)) throw new Error("fixture_prompt_token_invalid");
    const maxNodes = Number.isSafeInteger(opts.maxNodes) && opts.maxNodes > 0 ? opts.maxNodes : 20000;
    const lines = String(opts.prompt || "").split(/\r?\n/).map(normalize).filter(Boolean);
    const singleToken = opts.singleToken === true;
    const maskMarkedUser = opts.maskMarkedUser === true;
    const tokenFor = (i) => singleToken || lines.length === 1 ? token : `${token}-L${i + 1}`;
    const whole = normalize(lines.join(" "));
    const view = root.ownerDocument && root.ownerDocument.defaultView;
    const computed = opts.computedHidden !== false && view && typeof view.getComputedStyle === "function";
    const marks = new Map();
    for (const mark of opts.marks || []) {
      if (!Array.isArray(mark.path) || !EXPECT_TOKENS.includes(mark.token)) throw new Error("fixture_mark_invalid");
      const key = mark.path.join(".");
      marks.set(key, [...(marks.get(key) || []), mark.token]);
    }
    const placeholders = new Map(), counters = new Map();
    const placeholder = (prefix, value) => {
      const key = `${prefix}\u0000${value}`;
      if (!placeholders.has(key)) {
        counters.set(prefix, (counters.get(prefix) || 0) + 1);
        placeholders.set(key, `${prefix}-${counters.get(prefix)}`);
      }
      return placeholders.get(key);
    };
    const stats = { elements: 0, texts: 0, promptHits: 0, droppedElements: 0, droppedAttrs: 0, truncated: false, marked: 0 };
    let budget = maxNodes;

    function text(node) {
      const raw = node.nodeValue || "";
      if (!raw.trim()) return raw.includes("\n") ? "\n" : " ";
      stats.texts++;
      const value = normalize(raw);
      const lead = /^\s/.test(raw) ? " " : "", tail = /\s$/.test(raw) ? " " : "";
      if (lines.length && value === whole) {
        stats.promptHits++;
        return lead + (singleToken ? token : lines.map((_, i) => tokenFor(i)).join("\n")) + tail;
      }
      const line = lines.indexOf(value);
      if (line >= 0) { stats.promptHits++; return lead + tokenFor(line) + tail; }
      return lead + filler(value.length) + tail;
    }

    function attrs(el, path, tag) {
      const out = [];
      for (const attr of [...el.attributes]) {
        const name = attr.name.toLowerCase(), raw = attr.value;
        let value = null;
        // 页面自带的 data-polyask-expect 一律丢弃：期望标记只能来自采集脚本的 marks。
        if (name === EXPECT_ATTR || (name === "id" && PROSE_NO_ID_TAGS.includes(tag))) value = null;
        else if (name === "class") value = safeClass(raw);
        else if (name === "aria-label") value = raw ? placeholder("label", raw) : null;
        else if (SEMANTIC_DATA.includes(name)) value = !/^id-\d{1,5}$/.test(raw) && semanticDataOk(name, raw) ? raw : placeholder("id", raw);
        else if (isSafeDataAttr(name)) value = raw === "" || raw === "true" || raw === "false" ? raw : placeholder("id", raw);
        else if (KEEP_ATTRS.includes(name)) value = name === "hidden" || name === "disabled" ? "" : raw;
        if (value === null || !attrValueOk(name, value)) { stats.droppedAttrs++; continue; }
        if (name === "class" && !value) continue;
        out.push([name, value]);
      }
      // 只在活页面上取 computed：display:none 的节点补一个 hidden，回放时 md.js 的 drop() 才不失真。
      if (computed && !el.hasAttribute("hidden")) {
        try { if (view.getComputedStyle(el).display === "none") out.push(["hidden", ""]); } catch (_) {}
      }
      const expect = marks.get(path.join("."));
      if (expect) { stats.marked += expect.length; out.push([EXPECT_ATTR, expect.join(" ")]); }
      return out.map(([name, value]) => value === "" ? ` ${name}` : ` ${name}="${escapeAttr(value)}"`).join("");
    }

    let userTokenEmitted = false;
    function element(el, path, inUser = false) {
      const tag = String(el.localName || el.tagName || "").toLowerCase();
      if (!/^[a-z][a-z0-9-]*$/.test(tag) || DROP_TAGS.includes(tag)) { stats.droppedElements++; return ""; }
      if (--budget < 0) { stats.truncated = true; return ""; }
      stats.elements++;
      const open = `<${tag}${attrs(el, path, tag)}>`;
      if (VOID_TAGS.includes(tag)) return open;
      if (EMPTY_TAGS.includes(tag)) return `${open}</${tag}>`;
      const expect = marks.get(path.join("."));
      const nextInUser = inUser || !!(maskMarkedUser && expect && expect.includes("user"));
      if (nextInUser && tag === "button") return `${open}</${tag}>`;
      return `${open}${children(el, path, nextInUser)}</${tag}>`;
    }

    function children(el, path, inUser = false) {
      let out = "", index = 0;
      // textarea 的内容即文本节点；按普通文本占位处理，不保留草稿。
      for (let child = el.firstChild; child; child = child.nextSibling) {
        if (child.nodeType === 3) {
          if (inUser) {
            if ((child.nodeValue || "").trim() && !userTokenEmitted) {
              userTokenEmitted = true;
              stats.texts++;
              stats.promptHits++;
              out += escapeText(token);
            }
          } else {
            out += escapeText(text(child));
          }
        } else if (child.nodeType === 1) out += element(child, [...path, index++], inUser);
        if (stats.truncated) break;
      }
      return out;
    }

    const tag = String(root.localName || "").toLowerCase();
    // body/html 作根时只输出子节点：回放把 fixture 放进 <body>，嵌套 body 会被解析器吞掉。
    const parts = [tag === "body" || tag === "html" ? children(root, []) : element(root, [])];
    for (const [idx, extra] of (opts.extraRoots || []).entries()) {
      if (stats.truncated) break;
      if (extra && extra.nodeType === 1) {
        const chunk = element(extra, ["extra", idx]);
        if (chunk) parts.push(chunk);
      }
    }
    const html = parts.filter(Boolean).join("\n");
    return { html: html.replace(/[ \t]+\n/g, "\n").replace(/[ \t]+$/, ""), stats };
  }

  // 节点相对 root 的元素下标路径（逐层 children 下标），与 sanitizeDomFixture 的 marks.path 同一口径；
  // 不在 root 子树内返回 null。采集脚本在隔离上下文用它把生产 historyTurn() 的节点换算成路径。
  function elementPath(root, node) {
    const out = [];
    for (let el = node; el && el !== root; el = el.parentElement) {
      if (!el.parentElement) return null;
      out.unshift([...el.parentElement.children].indexOf(el));
    }
    return node && (node === root || out.length) ? out : null;
  }

  return {
    sanitizeDomFixture, elementPath, findSensitive, attrValueOk, isSafeId, isSafeDataAttr, safeClass,
    isPromptText, isFillerText, sanitizeRoute, isSanitizedRoute,
    FILLER, KEEP_ATTRS, SEMANTIC_DATA, PROSE_NO_ID_TAGS, EXPECT_ATTR, EXPECT_TOKENS, DROP_TAGS, EMPTY_TAGS, VOID_TAGS, PROMPT_TOKEN
  };
}));
