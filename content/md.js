// content/md.js — 可见 DOM → Markdown 通用序列化（汇总复制用），挂到 __AMS.toMarkdown。
// 不做逐站规则：九站回答区都是 markdown 渲染出的标准 HTML（h/p/ul/ol/table/pre/a/strong…），
// 一个串行器全站通吃。遍历时剔除隐藏节点（第三方注入的水印/翻译克隆）与操作件（按钮/svg），
// 所见即所得；链接保留为 [文本](href)（引用 chip 因此带回来源 URL），表格转 GFM 管道表。
// ponytail: 嵌套列表不缩进（平铺输出）——回答里深嵌套罕见，需要时再给 list 传递 depth。
(function () {
  "use strict";
  const S = window.__AMS;
  if (!S) return;
  const SKIP = new Set(["BUTTON", "SVG", "STYLE", "SCRIPT", "NOSCRIPT", "SELECT", "TEXTAREA", "AUDIO", "VIDEO"]);
  const drop = (el) => {
    if (SKIP.has(el.tagName.toUpperCase()) || el.getAttribute("aria-hidden") === "true" || el.getAttribute("role") === "button") return true;
    const cs = getComputedStyle(el);
    return cs.display === "none" || cs.visibility === "hidden";
  };
  let pendingLang = ""; // 代码块语言名放在 pre 外部头部条的站点（如 DeepSeek）：前瞻吸收进围栏
  function inline(node) {
    let out = "";
    for (const n of node.childNodes) {
      if (n.nodeType === 3) { out += n.nodeValue.replace(/\s+/g, " "); continue; }
      if (n.nodeType !== 1 || drop(n)) continue;
      const tag = n.tagName.toUpperCase();
      if (n.nextElementSibling && n.nextElementSibling.tagName.toUpperCase() === "PRE") {
        const ft = document.createTreeWalker(n, NodeFilter.SHOW_TEXT).nextNode(); // 首个文本节点（绕开头部条里的按钮文本）
        const t = ft ? ft.nodeValue.trim() : "";
        if (/^[A-Za-z0-9+#.-]{1,20}$/.test(t)) { pendingLang = t.toLowerCase(); continue; }
      }
      if (tag === "BR") { out += "\n"; continue; }
      if (tag === "IMG") continue;
      if (tag === "CODE") { out += "`" + (n.textContent || "").trim() + "`"; continue; }
      if (tag === "A") {
        const href = n.getAttribute("href") || "";
        const t = inline(n).trim();
        out += (href && !/^javascript:/i.test(href)) ? "[" + (t || href) + "](" + n.href + ")" : t;
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
  function list(el, ordered) {
    let out = "", i = 1;
    for (const li of [...el.children].filter((c) => c.tagName === "LI" && !drop(c))) {
      out += (ordered ? (i++) + ". " : "- ") + inline(li).trim().replace(/\n{2,}/g, "\n  ") + "\n";
    }
    return out + "\n";
  }
  function block(el) {
    if (drop(el)) return "";
    const tag = el.tagName.toUpperCase();
    if (/^H[1-6]$/.test(tag)) return "\n" + "#".repeat(+tag[1]) + " " + inline(el).trim() + "\n\n";
    if (tag === "P") { const t = inline(el).trim(); return t ? t + "\n\n" : ""; }
    if (tag === "PRE") { // 代码块：只取 code 本体（剔除站点加在 pre 头部的语言标签/复制按钮），语言进围栏
      const code = el.querySelector("code") || el;
      const lang = ((code.className || "").toString().match(/language-([\w+-]+)/) || [])[1] || pendingLang;
      pendingLang = "";
      return "```" + lang + "\n" + (code.innerText || code.textContent || "").replace(/\n+$/, "") + "\n```\n\n";
    }
    if (tag === "UL") return list(el, false);
    if (tag === "OL") return list(el, true);
    if (tag === "TABLE") return table(el);
    if (tag === "BLOCKQUOTE") { const t = inline(el).trim(); return t ? t.split("\n").map((l) => "> " + l).join("\n") + "\n\n" : ""; }
    if (tag === "HR") return "---\n\n";
    return inline(el); // 透明容器（div/section/span…）
  }
  S.toMarkdown = function (root) {
    if (!root) return "";
    pendingLang = "";
    return block(root).replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  };
})();
