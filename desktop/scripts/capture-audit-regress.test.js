"use strict";
// 2026-10-03 采集定位真机发送验证的审计缺陷回归（jsdom 整链回放，合成 DOM 按真机日志里的形态搭）：
// 智谱 ③ 把顶栏标题与测量副本认成本轮问答、Kimi 首屏路由迁移与用户节点同批替换、Kimi/千问思考段被当正文、
// 静止回答根被 once() 读取。除「迁移仍拒绝」这条对照外，每条都在修复前的代码上失败。
const assert = require("node:assert/strict");
const test = require("node:test");
const { replayHtml, replayFixture } = require("./lib/dom-replay");
const { setup, node } = require("./lib/history-harness");

const PROMPT = "PolyAsk capture check T3b: why do ginkgo trees live long?";
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const nodes = (document, html) => { const box = document.createElement("div"); box.innerHTML = html; return [...box.children]; };
function withRun(html, options, body) {
  const run = replayHtml(html, options);
  return Promise.resolve().then(() => body(run)).finally(() => run.close());
}
function later(run, ms) { const now = run.window.Date.now; run.window.Date.now = () => now() + ms; }

// 智谱 2026-10-03 形态：顶栏 div.chat-top-section 里的 p.conversation-name（新会话先显示问题原文）与其测量副本
// span.measure-span；真会话区 div.conversation-list-outer 与输入框同列、不包住输入框。类名避开第 ① 级选择器。
const GLM = '<div id="app"><main class="main"><div id="session-container" class="detail flex">'
  + '<div class="chat-top-section"><div class="middle"></div></div>'
  + '<div class="conversation-inner"><div class="conversation-list-outer"><div class="detail chatScrollContainer"></div></div></div>'
  + '<div class="input-wrap"><div class="editor" contenteditable="true" role="textbox"></div></div></div></main></div>';
const GLM_HOME = { host: "chatglm.cn", path: "/main/alltoolsdetail?lang=zh" };
const GLM_TURN = `<div class="item"><div class="q-row"><span>${PROMPT}</span></div>`
  + '<div class="a-row"><div class="markdown-body"><p>Ginkgo resists pests.</p></div></div></div>';

test("chatglm-shaped title echo: a cached anchor on the top-bar title never seals the question text as the answer", () =>
  withRun(GLM, GLM_HOME, async (run) => {
    const { document, S } = run;
    run.adapter.generation = () => null;
    S.history.begin("tok", PROMPT, Date.now() + 44_000, { images: 0 });
    // 1084 ms：标题先以问题原文唯一出现并被 ③ 绑定；2 ms 后测量副本成为第二处同文；随后真气泡与回答插入会话区。
    document.querySelector(".middle").append(...nodes(document, `<p class="conversation-name">${PROMPT}</p>`));
    await tick();
    document.querySelector(".middle").append(...nodes(document, `<span class="measure-span">${PROMPT}</span>`));
    await tick();
    document.querySelector(".chatScrollContainer").append(...nodes(document, GLM_TURN));
    await tick();
    run.adapter.generation = () => "generating";
    S.history.snapshot("tok");
    run.adapter.generation = () => null;
    later(run, 2_100);
    const snapshot = S.history.snapshot("tok");
    assert.notEqual(snapshot.text, PROMPT, "问题原文绝不能被当作回答封存");
    assert.equal(snapshot.text, undefined, "同文两处时读正文的那次定位必须拿不准");
    // 标题改名后真气泡唯一，但本轮早已绑在标题上：节点不同即终止，宁可不取也不取错。
    document.querySelector(".conversation-name").textContent = "Ginkgo longevity";
    document.querySelector(".measure-span").textContent = "Ginkgo longevity";
    const list = document.querySelector(".conversation-list-outer"), editor = document.querySelector(".editor");
    list.getBoundingClientRect = () => ({ left: 300, right: 900, width: 600, top: 0, bottom: 500, height: 500 });
    editor.getBoundingClientRect = () => ({ left: 320, right: 880, width: 560, top: 520, bottom: 560, height: 40 });
    const after = S.history.snapshot("tok");
    assert.equal(after.text, undefined);
    assert.equal(after.owned, false);
  }));

test("a class-named conversation list is only fenced when it sits beside the composer column", () =>
  withRun(GLM, GLM_HOME, async (run) => {
    const { document } = run;
    document.querySelector(".chatScrollContainer").append(...nodes(document, GLM_TURN));
    const ctx = () => ({ method: "anchor", anchor: true, text: PROMPT, cache: null });
    assert.equal(run.adapter.historyTurn(ctx()).user, null, "量不到布局时会话列表类名照旧排除");
    const list = document.querySelector(".conversation-list-outer");
    document.querySelector(".editor").getBoundingClientRect = () => ({ left: 320, right: 880, width: 560, top: 520, bottom: 560, height: 40 });
    list.getBoundingClientRect = () => ({ left: 300, right: 900, width: 600, top: 0, bottom: 500, height: 500 });
    const turn = run.adapter.historyTurn(ctx());
    assert.equal(turn.user, document.querySelector(".q-row span"), "与输入框同列的会话区不是侧栏");
    assert.equal(run.S.toMarkdown(turn.answer), "Ginkgo resists pests.");
    list.getBoundingClientRect = () => ({ left: 0, right: 280, width: 280, top: 0, bottom: 500, height: 500 });
    assert.equal(run.adapter.historyTurn(ctx()).user, null, "在输入框左右两侧的会话列表仍排除");
  }));

test("chatglm real fixture with measurable layout: the anchor finds the real bubble but refuses attribution (userCount 2)", () => {
  const run = replayFixture("chatglm-single-turn");
  try {
    const { document } = run, prompt = run.meta.expect.userText;
    document.querySelector("textarea").getBoundingClientRect = () => ({ left: 320, right: 880, width: 560, top: 520, bottom: 560, height: 40 });
    for (const el of document.querySelectorAll('[class*="conversation-list" i]')) el.getBoundingClientRect = () => ({ left: 300, right: 900, width: 600, top: 0, bottom: 500, height: 500 });
    const turn = run.adapter.historyTurn({ method: "anchor", anchor: true, text: prompt, cache: null });
    // 2026-10-04 T5 真机同形：气泡旁的「复制入框」div.copy-btn 与回答后的 followup-container 都算实质内容。
    const expected = document.querySelector('[data-polyask-expect~="user"]');
    assert.ok(turn.user && (expected.contains(turn.user) || turn.user.contains(expected)), "定位到的是真气泡");
    assert.equal(run.S.history.normalize(turn.text), prompt);
    assert.equal(turn.userCount, 2, "结构判不清时交给 bind() 拒绝，绝不归属");
  } finally { run.close(); }
});

const SIDEBAR = '<aside class="drawer"></aside>';
const COMPOSER = '<div class="composer-box"><div class="editor" contenteditable="true" role="textbox"></div></div>';
const page = (list) => `${SIDEBAR}<main class="shell"><div class="scroller"><div class="thread">${list}</div></div>${COMPOSER}</main>`;
const KIMI_HOME = { host: "www.kimi.com", path: "/" };
const userRow = (prompt = PROMPT) => `<div class="row-q"><div class="bubble">${prompt}</div></div>`;
const answerRow = (text, key = "a-1") => `<div class="row-a"${key ? ` data-row-id="${key}"` : ""}><div class="body"><div class="markdown"><p>${text}</p></div></div></div>`;

test("a keyless anchor root that never changed after binding is not sealed by quiet alone", () =>
  withRun(page('<div class="note">Static note under the thread</div>'), KIMI_HOME, async (run) => {
    const { document, S } = run;
    run.adapter.generation = () => null;
    S.history.begin("tok", PROMPT, Date.now() + 44_000, { images: 0 });
    document.querySelector(".thread").prepend(...nodes(document, userRow()));
    await tick();
    run.adapter.generation = () => "generating";
    assert.equal(S.history.snapshot("tok").owned, true);
    run.adapter.generation = () => null;
    later(run, 2_100);
    const snapshot = S.history.snapshot("tok");
    assert.equal(snapshot.text, undefined, "静止根（e.changedAt 从未赋值）不是流式长出来的回答");
    assert.equal(snapshot.ended, undefined);
  }));

test("Kimi anchor: route migration and optimistic user replacement in one batch keep the first turn", () =>
  withRun(page(""), KIMI_HOME, async (run) => {
    const { document, S, window } = run;
    S.history.begin("tok", PROMPT, Date.now() + 44_000, { images: 0 });
    window.history.pushState(null, "", "/chat/pd60provisional");
    document.querySelector(".thread").append(...nodes(document, userRow()));
    await tick();
    // 同一批：路由迁到服务端 id，乐观用户节点被同文新节点替换；缓存失效后整页遍历还在 500 ms 节流期。
    window.history.pushState(null, "", "/chat/1a1025b6final");
    document.querySelector(".row-q").replaceWith(...nodes(document, userRow()));
    await tick();
    assert.notEqual(S.history.snapshot("tok").ended, true, "路由迁移且尚未定位到用户时挂起，不终止");
    later(run, 600);
    document.querySelector(".thread").append(...nodes(document, answerRow("Ginkgo resists pests.")));
    await tick();
    const snapshot = S.history.snapshot("tok");
    assert.deepEqual({ owned: snapshot.owned, text: snapshot.text, locate: snapshot.locate },
      { owned: true, text: "Ginkgo resists pests.", locate: "anchor" });
    window.history.pushState(null, "", "/chat/another-conversation");
    assert.equal(S.history.snapshot("tok").ended, true, "只放行一次迁移");
  }));

const KIMI_USER = (prompt = PROMPT) => `<div class="chat-content-item chat-content-item-user"><div class="user-content">${prompt}</div></div>`;
const KIMI_ASSISTANT = (inner) => `<div class="chat-content-item chat-content-item-assistant" data-message-id="m-2">${inner}</div>`;

test("Kimi selectors: the same-batch migration also holds on level one (bound on the provisional route)", () =>
  withRun(page(""), KIMI_HOME, async (run) => {
    const { document, S, window } = run;
    S.history.begin("tok", PROMPT, Date.now() + 44_000, { images: 0 });
    window.history.pushState(null, "", "/chat/pd60provisional");
    document.querySelector(".thread").append(...nodes(document, KIMI_USER()));
    await tick();
    window.history.pushState(null, "", "/chat/1a1025b6final");
    document.querySelector(".chat-content-item-user").replaceWith(...nodes(document, KIMI_USER()));
    await tick();
    document.querySelector(".thread").append(...nodes(document, KIMI_ASSISTANT('<div class="segment-content"><div class="markdown"><p>Paris</p></div></div>')));
    await tick();
    const snapshot = S.history.snapshot("tok");
    assert.deepEqual({ owned: snapshot.owned, text: snapshot.text, locate: snapshot.locate }, { owned: true, text: "Paris", locate: "selector" });
  }));

test("Kimi migration still refuses a different connected user or a different text", () =>
  withRun(page(""), KIMI_HOME, async (run) => {
    const { document, S, window } = run;
    S.history.begin("tok", PROMPT, Date.now() + 44_000, { images: 0 });
    window.history.pushState(null, "", "/chat/pd60provisional");
    document.querySelector(".thread").append(...nodes(document, KIMI_USER()));
    await tick();
    window.history.pushState(null, "", "/chat/1a1025b6final");
    document.querySelector(".chat-content-item-user").replaceWith(...nodes(document, KIMI_USER("Another question")));
    await tick();
    assert.equal(S.history.snapshot("tok").ended, true);
  }));

test("anchor answer root with only a thinking markdown block yields no text", () =>
  withRun(page(""), KIMI_HOME, async (run) => {
    const { document, S } = run;
    S.history.begin("tok", PROMPT, Date.now() + 44_000, { images: 0 });
    document.querySelector(".thread").append(...nodes(document, userRow()
      + '<div class="row-a" data-row-id="a-1"><div class="thought-reasoning"><div class="markdown"><p>Thinking about the request</p></div></div></div>'));
    await tick();
    const snapshot = S.history.snapshot("tok");
    assert.equal(snapshot.owned, true);
    assert.equal(snapshot.text, undefined);
  }));

// Kimi 2026-10-03 真机：临时路由迁到服务端 id 的同一批里，乐观用户节点也被同文新节点替换；替换只在绑定后不久放行，
// 定位暂时拿不到用户（节流、重渲染中）时挂起不终止。
test('Kimi first-turn migration accepts a same-text replacement of the detached optimistic user only right after binding', () => {
  for (const [label, text, wait, owned] of [['replaced', 'Question', 0, true], ['deferred', 'Question', 0, true],
    ['other-text', 'Other', 0, false], ['late', 'Question', 10_001, false]]) {
    const s = setup('www.kimi.com'), user = node('Question');
    s.navigate('https://www.kimi.com/');
    s.S.history.begin('token', 'Question');
    s.navigate('https://www.kimi.com/chat/one');
    s.insert({ user, text: 'Question', userCount: 1 });
    user.isConnected = false; s.advance(wait);
    s.navigate('https://www.kimi.com/chat/two');
    if (label === 'deferred') {
      s.set({ user: null, userCount: 0 });
      assert.notEqual(s.S.history.snapshot('token').ended, true, label);
    }
    s.set({ user: node(text), text, answer: node('Answer'), userCount: 1 });
    assert.equal(s.S.history.snapshot('token').owned, owned, label);
  }
});
