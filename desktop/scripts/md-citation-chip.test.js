"use strict";
// D6（2026-10-04 Windows 真机）：智谱引用角标 span.source-item（域名 + 「+N」计数）被粘进副本正文：「…现象。cma.gov.cn+2」。
// 结构取自 fixtures-dom/chatglm-single-turn.html 的真实类名；在 jsdom 里跑生产 md.js。
const assert = require("node:assert/strict");
const test = require("node:test");
const { replayHtml, replayFixture } = require("./lib/dom-replay");

const chipHtml = (name, count, url) => `<span data-allow-html class="source-item source-aggregated" data-group-key="g" data-url="${url}">`
  + `<span data-allow-html class="source-item-num"><span class="source-item-num-name" data-allow-html>${name}</span>`
  + `<span data-allow-html class="source-item-num-count">${count}</span></span></span>`;

test("Zhipu citation chips are separated from the sentence and rendered as one citation", () => {
  const run = replayHtml('<div class="markdown-body">'
    + `<p>彩虹是大气光学现象。${chipHtml("cma.gov.cn", "+2", "https://www.cma.gov.cn/kppd/a(1).html")}</p>`
    + `<p>然后循环往复。${chipHtml("kepuchina.cn", "", "id-9")}${chipHtml("chinanews.com.cn", "+1", "javascript:alert(1)")}下一句。</p>`
    + "</div>", { host: "chatglm.cn", path: "/main/alltoolsdetail?cid=1" });
  try {
    assert.equal(run.S.toMarkdown(run.document.querySelector(".markdown-body")),
      "彩虹是大气光学现象。 [cma.gov.cn +2](https://www.cma.gov.cn/kppd/a%281%29.html)\n\n"
      + "然后循环往复。 [kepuchina.cn] [chinanews.com.cn +1] 下一句。");
  } finally { run.close(); }
});

test("ordinary links and text that only resemble chip class names keep the existing contract", () => {
  const run = replayHtml('<div class="markdown-body"><p>见<a href="https://example.com/x">来源</a>和<span class="source-item-num">plain</span>。</p></div>',
    { host: "chatglm.cn", path: "/main/alltoolsdetail?cid=1" });
  try {
    assert.equal(run.S.toMarkdown(run.document.querySelector(".markdown-body")), "见[来源](https://example.com/x)和plain。");
  } finally { run.close(); }
});

test("real Zhipu fixture: no citation chip label is glued to the preceding text", () => {
  const run = replayFixture("chatglm-single-turn");
  try {
    const text = run.S.toMarkdown(run.adapter.historyTurn().answer);
    const labels = [...run.document.querySelectorAll(".source-item")].filter((chip) => !chip.closest("[hidden]"))
      .map((chip) => chip.querySelector(".source-item-num-name").textContent.trim());
    assert.ok(labels.length > 0, "fixture 的正文里得有角标，用例才有意义");
    for (const label of labels) assert.ok(text.includes(`[${label}]`), `角标 ${label} 应自成一个引用`);
    assert.doesNotMatch(text, /\S\[lorem ipsum/, "角标前必须有空格");
  } finally { run.close(); }
});
