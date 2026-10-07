"use strict";
// 元宝 answer()（adapters-cn3.js）与汇总复制（read-commands.js collectAnswer → md.js）在 jsdom 里跑整条 preload 链。
// DOM 形状取自 2026-10-04 真机：思考段在 .agent-process-timeline 里，同样是 .hyc-common-markdown（带 -style-cot 修饰）；
// 正文引用角标 .hyc-common-markdown__ref-list 里是 13×13、无 alt 的来源图标。
const assert = require("node:assert/strict");
const test = require("node:test");
const { replayHtml } = require("./lib/dom-replay");

const HOST = { host: "yuanbao.tencent.com", path: "/chat/id-1/id-2" };
const COT = '<div class="hyc-content-md"><div class="hyc-common-markdown hyc-common-markdown-style hyc-common-markdown-style-cot">'
  + '<div class="ybc-p">thinking about the phrase</div></div></div>';
const TIMELINE = '<div class="agent-process-timeline_root__x agent-process-timeline"><div class="agent-process-timeline_group__x">'
  + '<div class="agent-process-timeline_groupThinkContent__x" data-agent-group-think-content="true"><div>' + COT + '</div></div></div></div>';
const HEADER = '<div class="hyc-component-deep-search-agent__think__header-container"><span>processed</span></div>';
const REF = '<div class="hyc-common-markdown__ref-list hyc-common-markdown__ref-list--merged" style="display:inline-flex"><div class="hyc-common-markdown__ref-list__trigger">'
  + '<div class="hyc-common-markdown__ref-list__item"><img class="hyc-common-markdown__ref-list__item__icon" width="13" height="13"></div></div></div>';
const BODY = '<div class="hyc-content-md hyc-content-md-done"><div class="hyc-common-markdown hyc-common-markdown-style answer-md">'
  + `<div class="ybc-p">It is a literary phrase.${REF}</div><div class="ybc-p">See <img alt="chart"> here.</div></div></div>`;
const speech = (inner) => '<div class="agent-chat__list__item agent-chat__list__item--ai"><div class="agent-chat__conv--ai__speech_show">'
  + `<div class="hyc-component-deep-search-agent">${inner}</div></div></div>`;

function withRun(html, body) {
  const run = replayHtml(html, HOST);
  return Promise.resolve().then(() => body(run)).finally(() => run.close());
}

test("Yuanbao thinking in the process timeline is never the answer, and a thinking-only reply has none yet", () =>
  withRun(speech(TIMELINE + HEADER), async (run) => {
    assert.equal((run.adapter.answer()) === (null), true, "只有思考段：还没有正文，不能退回整个容器把推理过程写进副本");
    const summary = await run.send({ source: "AMS", cmd: "collectAnswer" });
    assert.equal(summary.text, null);
  }));

test("Yuanbao answer skips the cot markdown and citation icons while keeping real images", () =>
  withRun(speech(TIMELINE + HEADER + BODY), async (run) => {
    assert.equal((run.adapter.answer()) === (run.document.querySelector(".answer-md")), true);
    const summary = await run.send({ source: "AMS", cmd: "collectAnswer" });
    assert.equal(summary.text, "It is a literary phrase.\n\nSee [chart] here.");
  }));

test("Yuanbao falls back to the whole speech container only when neither thinking nor a timeline exists", () =>
  withRun(speech('<div class="plain">Plain reply</div>'), async (run) => {
    assert.equal((run.adapter.answer()) === (run.document.querySelector(".agent-chat__conv--ai__speech_show")), true);
  }));

test("Yuanbao keeps a non-markdown final reply when only the persistent deep-search think header remains", () =>
  withRun(speech(HEADER + '<div class="notice">Service busy, try later</div>'), async (run) => {
    assert.equal((run.adapter.answer()) === (run.document.querySelector(".agent-chat__conv--ai__speech_show")), true,
      "头部条不是思考正文：不能让繁忙提示/卡片类终态恒为 null");
  }));
