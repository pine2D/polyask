// desktop/src/site-runtime/md.js — 可见 DOM → Markdown 通用序列化（汇总复制用），挂到 __AMS.toMarkdown。
// 不做逐站规则：九站回答区都是 markdown 渲染出的标准 HTML（h/p/ul/ol/table/pre/a/strong…），
// 一个串行器全站通吃。遍历时剔除隐藏节点（第三方注入的水印/翻译克隆）与操作件（按钮/svg），
// 所见即所得；链接保留为 [文本](href)（引用 chip 因此带回来源 URL），href 中的圆括号会被
// 百分号编码防止截断目标；表格转 GFM 管道表。
// 图片不贴签名/临时 src（会产出死链或过期图），只保留 alt 占位，保证纯图回答 text 非空。
// 嵌套列表按层缩进（无序 2 空格、有序 3 空格，即父项标记宽度）；KaTeX 还原为 TeX（行内 $..$、块级 $$..$$），
// 优先 data-latex，其次 annotation[encoding="application/x-tex"]，都没有则退回常规遍历。
(function () {
  "use strict";
  const S = window.__AMS;
  if (!S) return;
  const t = globalThis.__AMS_I18N__ ? globalThis.__AMS_I18N__.t : globalThis.t; // 与其余 site-runtime 文件同一取法；漏了这行 md_image 就是死词条
  const SKIP = new Set(["BUTTON", "SVG", "STYLE", "SCRIPT", "NOSCRIPT", "SELECT", "TEXTAREA", "AUDIO", "VIDEO"]);
  const drop = (el) => {
    if (SKIP.has(el.tagName.toUpperCase()) || el.getAttribute("aria-hidden") === "true" || el.getAttribute("role") === "button") return true;
    const cs = getComputedStyle(el);
    return cs.display === "none" || cs.visibility === "hidden";
  };
  let pad = ""; // 当前列表嵌套缩进：list() 进入子项时累加父项标记宽度，嵌套列表各行以此为前缀
  let pendingLang = ""; // 代码块语言名放在 pre 外部头部条的站点（如 DeepSeek）：前瞻吸收进围栏
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
  // 首个非空文本节点（头部条内常有纯空白文本节点垫在语言名前，真机实证：Kimi）
  function firstTextNode(root) {
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let ft = w.nextNode();
    while (ft && !ft.nodeValue.trim()) ft = w.nextNode();
    return ft;
  }
  function backtickFence(text, minimum) {
    const runs = (text.match(/`+/g) || []).map((x) => x.length);
    return "`".repeat(Math.max(minimum || 1, (runs.length ? Math.max(...runs) : 0) + 1));
  }
  function safeHref(node) {
    const raw = node.getAttribute("href");
    if (!raw) return "";
    try {
      const url = new URL(raw, location.href);
      return /^(https?:|mailto:|tel:)$/.test(url.protocol) ? url.href : "";
    } catch (e) { return ""; }
  }
  // URL 归一化不编码圆括号，裸拼进 [文本](href) 会被 CommonMark 的括号配平规则截断目标
  // （真机实证：带查询参数的右括号 URL）。只编码目标本身，链接文本仍显示原始 href。
  function mdUrl(href) { return href.replace(/[()]/g, (c) => (c === "(" ? "%28" : "%29")); }
  // KaTeX → TeX：.katex-display 为块级，.katex 为行内；取不到 TeX 返回 null 让常规遍历兜底
  // （.katex-html 带 aria-hidden 会被 drop 跳过，annotation 是 display:none，只能直接读不能遍历）
  function math(n) {
    const cls = " " + (n.className || "").toString() + " ";
    const display = cls.includes(" katex-display ");
    if (!display && !cls.includes(" katex ")) return null;
    const src = n.getAttribute("data-latex") ? n : n.querySelector("[data-latex]");
    const ann = n.querySelector('annotation[encoding="application/x-tex"]');
    const tex = ((src && src.getAttribute("data-latex")) || (ann && ann.textContent) || "").trim();
    if (!tex) return null;
    return display ? "\n$$\n" + tex + "\n$$\n\n" : "$" + tex.replace(/\s+/g, " ") + "$";
  }
  function inline(node) {
    let out = "";
    for (const n of node.childNodes) {
      // 文本转义：成对的 * _ [ ] ` 会被下游渲染器解析成强调/链接（真机实证 a_i 与 b_j 同段即触发）
      if (n.nodeType === 3) { out += n.nodeValue.replace(/\s+/g, " ").replace(/([\\`*_\[\]])/g, "\\$1"); continue; }
      if (n.nodeType !== 1 || drop(n)) continue;
      const tag = n.tagName.toUpperCase();
      const tex = math(n);
      if (tex !== null) { out += tex; continue; }
      // 语义标签绝不吸收：ChatGPT 的 h3 直邻 pre（真机实证），旧逻辑会把「### Example」吞成语言名
      if (!/^(H[1-6]|P|LI|UL|OL|TABLE|BLOCKQUOTE)$/.test(tag) && preAhead(n)) {
        const ft = firstTextNode(n); // 首个非空文本节点（绕开头部条里的空白垫片与按钮文本）
        const t = ft ? ft.nodeValue.trim() : "";
        if (/^[A-Za-z0-9+#.-]{1,20}$/.test(t)) { pendingLang = t.toLowerCase(); continue; }
      }
      if (tag === "BR") { out += "\n"; continue; }
      if (tag === "IMG") { // 不贴 src（多为签名/临时短效 URL），只留 alt 占位保证 text 非空
        const alt = (n.getAttribute("alt") || "").trim().replace(/\s+/g, " ").replace(/([\\`*_\[\]])/g, "\\$1");
        out += "[" + (alt || (typeof t === "function" ? t("md_image") : "图片")) + "]";
        continue;
      }
      if (tag === "CODE") { // 内容自带反引号时用双反引号+空格包裹（CommonMark），防提前截断
        const c = (n.textContent || "").trim();
        const fence = backtickFence(c, 1), pad = c.includes("`") ? " " : "";
        out += fence + pad + c + pad + fence; continue;
      }
      if (tag === "A") {
        const href = safeHref(n);
        const t = inline(n).trim();
        out += href ? "[" + (t || href) + "](" + mdUrl(href) + ")" : t;
        continue;
      }
      if (tag === "STRONG" || tag === "B") { const t = inline(n).trim(); out += t ? "**" + t + "**" : ""; continue; }
      if (tag === "EM" || tag === "I") { const t = inline(n).trim(); out += t ? "*" + t + "*" : ""; continue; }
      out += block(n); // 行内位置遇到块级子树 → 按块处理（p/列表/表格断行得以保留）
    }
    return out;
  }
  function table(el) {
    const rows = [...el.querySelectorAll("tr")].filter((r) => !drop(r));
    if (!rows.length) return "";
    const cells = (r) => [...r.children].filter((c) => /^(TD|TH)$/.test(c.tagName))
      .map((c) => inline(c).trim().replace(/\|/g, "\\|").replace(/\n+/g, " "));
    const lines = rows.map((r) => "| " + cells(r).join(" | ") + " |");
    lines.splice(1, 0, "| " + cells(rows[0]).map(() => "---").join(" | ") + " |");
    return "\n" + lines.join("\n") + "\n\n";
  }
  // 列表另起一行：前一段若是 div 段落或行内文字，"- " 不能粘在其行尾。
  // 站点自绘的项目符号（元宝 `•` / 有序项 `4.`）与本序列化器的标记重复，只保留后者。
  // 列表项续行：围栏外的空行压掉、其余行补 cw 缩进（嵌套列表的行已自带 cw 前缀）；围栏代码块（含围栏行）逐字保留，
  // 不补缩进也不压空行——toMarkdown 收尾把围栏行剥回第 0 列，代码正文因此与围栏同列、相对缩进不变。
  // 围栏按 CommonMark 配对：收尾行只含反引号且不短于开头（backtickFence 保证正文里的反引号串都更短）。
  function indentItem(text, cw) {
    const out = [];
    let fence = 0;
    text.split("\n").forEach((l, k) => {
      const m = /^[ \t]*(`{3,})(.*)$/.exec(l);
      if (fence) { if (m && m[1].length >= fence && !m[2].trim()) fence = 0; out.push(l); return; }
      if (m) { fence = m[1].length; out.push(l); return; }
      if (k && !l) return;
      out.push(k && !l.startsWith(cw) ? cw + l : l);
    });
    return out.join("\n");
  }
  function list(el, ordered) {
    const pad0 = pad, cw = pad0 + (ordered ? "   " : "  ");
    let out = "\n", i = (ordered && parseInt(el.getAttribute("start"), 10)) || 1;
    for (const li of [...el.children].filter((c) => c.tagName === "LI" && !drop(c))) {
      const marker = ordered ? new RegExp("^" + i + "[.)、]\\s*") : /^[•·●◦▪‣]\s*/;
      pad = cw; // 子项内的嵌套列表以父项标记宽度缩进
      const text = inline(li).trim().replace(marker, "");
      pad = pad0;
      out += pad0 + (ordered ? (i++) + ". " : "- ") + indentItem(text, cw) + "\n";
    }
    return out + "\n";
  }
  // 站点用 div 当段落（元宝 .ybc-p，2026-10-03 真机）：只含行内内容且有文字的块级 div 按段落断行；
  // 包裹块级子树的 div 仍是透明容器。
  function paragraphDiv(el) {
    if (el.tagName.toUpperCase() !== "DIV" || /^inline/.test(getComputedStyle(el).display) || !(el.textContent || "").trim()) return false;
    return [...el.children].every((c) => c.tagName.toUpperCase() === "BR" || drop(c) || /^inline/.test(getComputedStyle(c).display));
  }
  function block(el) {
    if (drop(el)) return "";
    const tex = math(el);
    if (tex !== null) return tex;
    const tag = el.tagName.toUpperCase();
    if (/^H[1-6]$/.test(tag)) return "\n" + "#".repeat(+tag[1]) + " " + inline(el).trim() + "\n\n";
    if (tag === "P") { const t = inline(el).trim(); return t ? t + "\n\n" : ""; }
    if (tag === "PRE") { // 代码块：只取 code 本体（剔除站点加在 pre 头部的语言标签/复制按钮），语言进围栏
      const code = el.querySelector("code") || el;
      let lang = ((code.className || "").toString().match(/language-([\w+-]+)/) || [])[1] || pendingLang;
      if (!lang && code !== el) { // 语言头在 pre 内部且 code 无 class 的站点（真机实证：ChatGPT）
        const ft = firstTextNode(el);
        const t = ft && !code.contains(ft) ? ft.nodeValue.trim() : "";
        if (/^[A-Za-z0-9+#.-]{1,20}$/.test(t)) lang = t.toLowerCase();
      }
      pendingLang = "";
      const body = (code.innerText || code.textContent || "").replace(/\n+$/, "");
      const fence = backtickFence(body, 3);
      return fence + lang + "\n" + body + "\n" + fence + "\n\n";
    }
    if (tag === "UL") return list(el, false);
    if (tag === "OL") return list(el, true);
    if (tag === "TABLE") return table(el);
    // 引用块自成容器：内部列表从零缩进起算（外层列表项的续行缩进加在 "> " 之前；智谱 li>blockquote>ul，2026-10-03 真机）
    if (tag === "BLOCKQUOTE") { const pad0 = pad; pad = ""; const t = inline(el).trim(); pad = pad0; return t ? t.split("\n").map((l) => "> " + l).join("\n") + "\n\n" : ""; }
    if (tag === "HR") return "---\n\n";
    if (paragraphDiv(el)) { const t = inline(el).trim(); return t ? "\n" + t + "\n\n" : ""; }
    return inline(el); // 透明容器（div/section/span…）
  }
  S.toMarkdown = function (root) {
    if (!root) return "";
    pendingLang = ""; pad = "";
    return block(root).replace(/[ \t]+\n/g, "\n").replace(/^[ \t]+(`{3,})/gm, "$1").replace(/\n{3,}/g, "\n\n").trim();
  };
})();
