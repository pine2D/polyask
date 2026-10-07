"use strict";
// 2026-10-04 Windows 第 4 轮真机副本里混进的站点界面件（jsdom 整链回放，结构取自真机 outerHTML / 站点前端包，文本已换成占位）：
// 智谱无语言名代码块的头部条、千问长文写作卡的标题与创建时间、豆包深度思考中的步骤标题。每条都在修复前的代码上失败。
const assert = require("node:assert/strict");
const test = require("node:test");
const { replayHtml } = require("./lib/dom-replay");

function withRun(html, options, body) {
  const run = replayHtml(html, options);
  try { return body(run); } finally { run.close(); }
}

// 智谱代码块（2026-10-04 真机 outerHTML）：div.code-no-artifacts > div.top-outer > div.top > [p.language, div.copy-button > svg + span「复制」]，
// 正文在 div.markdown-body.md-code > div.language.language-<名> > pre.hljs > code。无语言名时 p.language 为空、外层类名是 language-。
const glmCode = (lang, code, pointer) => '<div><div class="code-no-artifacts"><div class="top-outer"><div class="top">'
  + `<p class="language">${lang}</p><div class="copy-button"${pointer ? ' style="cursor: pointer"' : ""}><svg></svg><span>复制</span></div></div></div>`
  + '<div class="markdown-body md-code md-body tl">\n        '
  + `<div class="language language-${lang}" lang="${lang}">\n          <pre class="hljs"><code>${code}\n</code>`
  + '<span aria-hidden="true" class="line-numbers-rows"><span></span></span></pre>\n        </div>\n      </div></div></div>';
const glmText = (inner) => `<div><div class="markdown-body md-body tl">${inner}</div></div>`;
const glmAnswer = (parts) => `<div class="answer-content"><div class="answer-content-wrap"><div>${parts.join("")}</div></div></div>`;

for (const pointer of [false, true]) test(`chatglm: a code block without a language starts its own fence and drops the copy chrome (copy button ${pointer ? "with" : "without"} pointer cursor)`, () =>
  withRun(glmAnswer([glmText("<h1>Lorem list</h1><ol><li><strong>Red</strong> one</li><li><strong>Blue</strong> two</li></ol>"),
    glmCode("python", 'print("red")', pointer), glmText("<p>Output:</p>"), glmCode("", "red blue", pointer)]),
  { host: "chatglm.cn", path: "/main/alltoolsdetail?lang=zh&cid=id-1" }, (run) => {
    const md = run.S.toMarkdown(run.adapter.answer());
    assert.equal(md, '# Lorem list\n\n1. **Red** one\n2. **Blue** two\n\n```python\nprint("red")\n```\n\nOutput:\n\n```\nred blue\n```');
    assert.doesNotMatch(md, /复制/, "头部条的复制键不进副本");
  }));

test("a code fence that follows inline text in the same container still starts on its own line", () =>
  withRun('<div class="answer"><span>Result:</span><pre><code>x = 1</code></pre></div>', { host: "chatglm.cn", path: "/main/alltoolsdetail?cid=id-1" }, (run) => {
    assert.equal(run.S.toMarkdown(run.document.querySelector(".answer")), "Result:\n```\nx = 1\n```");
  }));

test("a header strip that carries an image is not dropped as copy chrome", () =>
  withRun('<div class="answer"><div><img alt="chart"></div><div><pre><code>x = 1</code></pre></div></div>', { host: "chatglm.cn", path: "/main/alltoolsdetail?cid=id-1" }, (run) => {
    assert.equal(run.S.toMarkdown(run.document.querySelector(".answer")), "[chart]\n```\nx = 1\n```");
  }));

// 千问长文写作卡（qianwen-web 4.9.1 前端包 aiWritingCard）：可点卡片外壳 div[data-card-highlight-target]（card-container-narrow/wide-<hash>）
// 里是图标、标题 title-<hash> 与 sub-title > description「创建于 MM-DD HH:mm」；卡前后的正文（leadingText / tailText）在外壳之外。
// u4-cancel-after-seal 的副本以「森林火灾的成因与预防\n\n创建于 10-04 20:50」收尾。
const QW_CARD = '<div class="narrow-x"><div class="card-container-narrow-Ke6Kp8" data-card-highlight-target="true"><svg></svg>'
  + '<div class="info-A9gUMl"><div class="title-gmVvaF">Lorem title</div><div class="sub-title-et0JOK"><div class="description-O1zSt4">创建于 10-04 20:50</div></div></div></div>'
  + '<div class="tail-text"><p>Tail ipsum.</p></div></div>';
for (const [label, html] of [["inside the answer markdown", `<div class="answer-common-card"><div class="qk-markdown qk-markdown-react"><h3>Lorem title</h3><p>Body ipsum.</p>${QW_CARD}</div></div>`],
  ["in a card without markdown blocks", `<div class="answer-common-card"><h3>Lorem title</h3><p>Body ipsum.</p>${QW_CARD}</div>`]]) {
  test(`qianwen: the writing-card title and created time stay out of the copy (${label})`, () =>
    withRun(html, { host: "www.qianwen.com", path: "/chat/id-1" }, (run) => {
      const md = run.S.toMarkdown(run.adapter.answer());
      assert.equal(md, "### Lorem title\n\nBody ipsum.\n\nTail ipsum.");
      assert.doesNotMatch(md, /创建于/);
    }));
}

// 长文默认写进画布时回答可能只有卡片，外壳外还有「在对话中输出」按钮（output-in-chat > label，aiWritingCard.card.answerInChat）：
// 副本保留标题、不含按钮文案与创建时间，不能为空；有正文时按钮文案同样剔除（2026-10-04 审查）。
const QW_ONLY = '<div class="card-container-narrow-Ke6Kp8" data-card-highlight-target="true"><svg></svg><div class="info-A9gUMl">'
  + '<div class="title-gmVvaF">Lorem title</div><div class="sub-title-et0JOK"><div class="description-O1zSt4">创建于 10-04 20:50</div></div></div></div>'
  + '<div class="output-in-chat-Xq1"><div class="label-Pq2">在对话中输出</div></div>';
for (const [label, html, expected] of [["a card-only reply", `<div class="answer-common-card">${QW_ONLY}</div>`, "Lorem title"],
  ["a reply with body text", `<div class="answer-common-card"><div class="qk-markdown"><p>Body ipsum.</p></div>${QW_ONLY}</div>`, "Body ipsum."]]) {
  test(`qianwen: the writing card keeps its title only when it is the whole reply, never the answer-in-chat label (${label})`, () =>
    withRun(html, { host: "www.qianwen.com", path: "/chat/id-1" }, (run) => {
      const answer = run.adapter.answer();
      const md = run.S.toMarkdown(answer);
      assert.equal(md, expected);
      assert.doesNotMatch(md, /创建于|在对话中输出/);
    }));
}

// 豆包深度思考（2026-10-04 前端包：思考块的插件节点 data-plugin-identifier="block_type:10040 | thinking_block.scene:0"，正文块 block_type:10000；
// 思考进度区 data-message-selection-module="thinking_progress" 也用 MdBox 渲染；真机快照：思考中副本是「正在思考\n\n规划说明结构」）。
// 只有思考块时 answer() 返回 null，正文出现后只取正文。
const mdBox = (text) => `<div data-testid="message_text_content" class="container-qX9Csx md-box-root"><p>${text}</p></div>`;
const DB_THINKS = {
  "thinking plugin block": '<div data-plugin-identifier="block_type:10040 | thinking_block.scene:0"><div class="think-head-x">正在思考</div>'
    + `<div data-plugin-identifier="block_type:10000">${mdBox("规划说明结构")}</div></div>`,
  "thinking progress module": `<div><div class="think-collapse-block-XvJz0W" data-message-selection-module="thinking_progress">${mdBox("正在思考")}${mdBox("规划说明结构")}</div></div>`
};
const DB_BODY = `<div data-plugin-identifier="block_type:10000">${mdBox("Answer ipsum.")}</div>`;
const dbPage = (inner) => '<main><div class="list_items">'
  + '<div data-testid="message_content" data-message-id="id-1" class="flex-row flex w-full justify-end"><div data-testid="message_text_content" class="md-box-root">Question</div></div>'
  + `<div data-testid="message_content" data-message-id="id-2" class="relative grid w-full"><div data-container-type="block-v2">${inner}</div></div>`
  + '</div><div class="composer"><textarea data-testid="chat_input_input"></textarea></div></main>';

for (const [label, thinking] of Object.entries(DB_THINKS)) test(`doubao: a reply that so far only holds the thinking steps is not the answer yet (${label})`, () =>
  withRun(dbPage(thinking), { host: "www.doubao.com", path: "/chat/38445437171009282" }, (run) => {
    assert.equal((run.adapter.answer()) === (null), true, "思考中的步骤标题不能当正文");
    assert.equal((run.adapter.historyTurn({ method: "selector" }).answer) === (null), true);
    run.document.querySelector('[data-container-type="block-v2"]').insertAdjacentHTML("beforeend", DB_BODY);
    assert.equal(run.S.toMarkdown(run.adapter.answer()), "Answer ipsum.", "正文出现后只取正文块");
    run.document.querySelector('[data-container-type="block-v2"]').replaceChildren();
    assert.equal((run.adapter.answer()) === (run.document.querySelector('[data-message-id="id-2"]')), true, "空占位消息照旧返回消息本身");
  }));

// 思考块完成后折叠常驻、终态却不是 MdBox（繁忙/违规提示、卡片、图片类结果）：退回思考块之后的那段内容，不是 null 也不带思考步骤（2026-10-04 审查）。
for (const [label, thinking] of Object.entries(DB_THINKS)) test(`doubao: a finished thinking block followed by a non-MdBox reply yields that reply (${label})`, () =>
  withRun(dbPage(thinking + '<div class="notice-x"><span>Busy ipsum.</span></div>'), { host: "www.doubao.com", path: "/chat/38445437171009282" }, (run) => {
    const answer = run.adapter.answer();
    assert.equal((answer) === (run.document.querySelector(".notice-x")), true);
    assert.equal(run.S.toMarkdown(answer), "Busy ipsum.");
  }));
