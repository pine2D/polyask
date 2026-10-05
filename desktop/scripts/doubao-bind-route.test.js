"use strict";
// 豆包首问绑定的路由守卫（history-route.js freshBind，2026-10-04 审查）：begin 在首页（/chat/）时，本轮用户只能在首页或本轮的
// local_ 上确立；绑定前页面被推到任何 /chat/<id>（侧栏点开同文单轮旧会话、页面自己跳转），那里的问答都不属于本轮——旧实现会
// 绑上去并把旧会话的回答记成副本。正式 id 只能经 rebase() 从已绑定的 local_ 迁移到达。合法序列（local_ 绑定后迁移、首页直接
// 绑定、已有会话里的追问）照常取到副本。jsdom 整链回放，结构同 doubao-new-chat-capture.test.js。
const assert = require("node:assert/strict");
const test = require("node:test");
const { replayHtml } = require("./lib/dom-replay");

const PROMPT = "PolyAsk 测试 F5：请用一句话解释彩虹是怎么形成的。";
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const PAGE = '<main class="chat"><div class="message-list"><div class="list_items"></div></div>'
  + '<div class="composer"><textarea data-testid="chat_input_input"></textarea></div></main>';
const user = (text, id) => `<div class="v_list_row"><div data-testid="send_message" data-message-role="user" class="flex flex-row w-full justify-end">`
  + `<div data-testid="message_content"${id ? ` data-message-id="${id}"` : ""} class="flex-row flex w-full justify-end">`
  + `<div data-testid="message_text_content" class="container-qX9Csx md-box-root"><div>${text}</div></div></div></div></div>`;
const answer = (text, id) => '<div class="v_list_row"><div data-testid="receive_message" data-message-role="assistant" class="flex flex-row w-full group">'
  + `<div data-testid="message_content"${id ? ` data-message-id="${id}"` : ""} class="relative grid w-full">`
  + `<div data-testid="message_text_content" class="container-qX9Csx md-box-root"><p>${text}</p></div></div></div></div>`;

function withRun(path, body) {
  const run = replayHtml(PAGE, { host: "www.doubao.com", path });
  return Promise.resolve().then(() => body(run)).finally(() => run.close());
}
function append(run, html) {
  const box = run.document.createElement("div");
  box.innerHTML = html;
  run.document.querySelector(".list_items").append(...box.children);
}
const state = (snapshot) => ({ owned: snapshot.owned, ended: snapshot.ended, text: snapshot.text ?? null });

// 理论竞态：begin 之后、本轮气泡出现之前页面被推到一个同文单轮旧会话（push 换槽），旧会话的节点在 begin 之后插入，wasInserted 也成立。
for (const keyed of [true, false]) test(`Doubao: a push to an old same-text chat before binding never binds there (${keyed ? "level one" : "level two"})`, () =>
  withRun("/chat/", async (run) => {
    run.S.history.begin("tok", PROMPT, Date.now() + 44_000, { images: 0 });
    run.window.history.pushState(null, "", "/chat/11111111111111111");
    append(run, user(PROMPT, keyed ? "old-u" : "") + answer("昨天的旧回答", keyed ? "old-a" : ""));
    await tick();
    assert.deepEqual(state(run.S.history.snapshot("tok")), { owned: false, ended: true, text: null }, "旧会话的回答不得记成本轮副本");
    assert.equal(run.S.history.submitted("tok"), false);
  }));

test("Doubao: begun on one local_ route, a different local_ route cannot bind the first turn", () =>
  withRun("/chat/local_1111111111111111", async (run) => {
    run.S.history.begin("tok", PROMPT, Date.now() + 44_000, { images: 0 });
    run.window.history.pushState(null, "", "/chat/local_2222222222222222");
    append(run, user(PROMPT) + answer("别的临时会话"));
    await tick();
    assert.deepEqual(state(run.S.history.snapshot("tok")), { owned: false, ended: true, text: null });
  }));

test("Doubao: binding on the home route itself (no local_ push) still captures", () =>
  withRun("/chat/", async (run) => {
    run.S.history.begin("tok", PROMPT, Date.now() + 44_000, { images: 0 });
    append(run, user(PROMPT) + answer("阳光射入水滴"));
    await tick();
    assert.deepEqual(state(run.S.history.snapshot("tok")), { owned: true, ended: undefined, text: "阳光射入水滴" });
  }));

test("Doubao: bind on local_, then the replace to the server id and node swap keep the copy", () =>
  withRun("/chat/", async (run) => {
    run.S.history.begin("tok", PROMPT, Date.now() + 44_000, { images: 0 });
    run.window.history.pushState(null, "", "/chat/local_6289182192238156");
    append(run, user(PROMPT) + answer("阳光"));
    await tick();
    assert.equal(run.S.history.snapshot("tok").owned, true);
    run.window.history.replaceState(null, "", "/chat/38445542823827970");
    run.document.querySelector(".list_items").innerHTML = "";
    append(run, user(PROMPT, "24533762") + answer("阳光射入水滴", "24533763"));
    await tick();
    const snapshot = run.S.history.snapshot("tok");
    assert.deepEqual({ ...state(snapshot), locate: snapshot.locate }, { owned: true, ended: undefined, text: "阳光射入水滴", locate: "selector" });
  }));

test("Doubao: a follow-up begun on an existing /chat/<id> conversation still binds there", () =>
  withRun("/chat/38445437171009282", async (run) => {
    append(run, user("上一个问题", "u-1") + answer("上一个回答", "a-1"));
    run.S.history.begin("tok", PROMPT, Date.now() + 44_000, { images: 0 });
    append(run, user(PROMPT, "u-2") + answer("追问的回答", "a-2"));
    await tick();
    assert.deepEqual(state(run.S.history.snapshot("tok")), { owned: true, ended: undefined, text: "追问的回答" });
  }));

// 首问后页面卡在 local_（后台页 2 分钟后仍是 local_，u1-doubao-4-bgpage-think）时直接追问：local_ 先被原地 replace 成正式 id、追问气泡
// 后到，同槽 replace 放行；replace 之后又 push 到别的会话（换槽）不得绑定。两种时序（先绑定后 replace / 先 replace 后绑定）结果一致。
const STUCK = "/chat/local_2112916723088784";
for (const replaceFirst of [false, true]) test(`Doubao: a follow-up begun on a stuck local_ page captures whether the in-place replace comes ${replaceFirst ? "before" : "after"} binding`, () =>
  withRun(STUCK, async (run) => {
    append(run, user("第一问", "u-1") + answer("第一答", "a-1"));
    run.S.history.begin("tok", PROMPT, Date.now() + 44_000, { images: 0 });
    if (replaceFirst) run.window.history.replaceState(null, "", "/chat/38445524882634498");
    append(run, user(PROMPT, "u-2") + answer("追问回答", "a-2"));
    await tick();
    if (!replaceFirst) { run.window.history.replaceState(null, "", "/chat/38445524882634498"); await tick(); }
    assert.deepEqual(state(run.S.history.snapshot("tok")), { owned: true, ended: undefined, text: "追问回答" });
  }));

test("Doubao: begun on a stuck local_ page, a push to another chat after the replace never binds there", () =>
  withRun(STUCK, async (run) => {
    append(run, user("第一问", "u-1") + answer("第一答", "a-1"));
    run.S.history.begin("tok", PROMPT, Date.now() + 44_000, { images: 0 });
    run.window.history.replaceState(null, "", "/chat/38445524882634498");
    run.window.history.pushState(null, "", "/chat/11111111111111111");
    append(run, user(PROMPT, "old-u") + answer("昨天的旧回答", "old-a"));
    await tick();
    assert.deepEqual(state(run.S.history.snapshot("tok")), { owned: false, ended: true, text: null });
  }));

// 首页直接绑定之后第一次离开首页：push 到同文单轮旧会话（换槽）结束本轮，不经乐观替换分支换绑过去；同槽 replace 成正式 id 照常取到副本。
for (const keyed of [true, false]) test(`Doubao: after binding on the home route, a push to an old same-text chat ends the copy (${keyed ? "level one" : "level two"})`, () =>
  withRun("/chat/", async (run) => {
    run.S.history.begin("tok", PROMPT, Date.now() + 44_000, { images: 0 });
    append(run, user(PROMPT));
    await tick();
    assert.equal(run.S.history.snapshot("tok").owned, true);
    run.window.history.pushState(null, "", "/chat/11111111111111111");
    run.document.querySelector(".list_items").innerHTML = "";
    append(run, user(PROMPT, keyed ? "old-u" : "") + answer("昨天的旧回答", keyed ? "old-a" : ""));
    await tick();
    assert.deepEqual(state(run.S.history.snapshot("tok")), { owned: false, ended: true, text: null }, "旧会话的回答不得记成本轮副本");
  }));

test("Doubao: after binding on the home route, an in-place replace to the server id keeps the copy", () =>
  withRun("/chat/", async (run) => {
    run.S.history.begin("tok", PROMPT, Date.now() + 44_000, { images: 0 });
    append(run, user(PROMPT));
    await tick();
    run.window.history.replaceState(null, "", "/chat/38445542823827970");
    run.document.querySelector(".list_items").append(...(() => { const b = run.document.createElement("div"); b.innerHTML = answer("阳光射入水滴"); return b.children; })());
    await tick();
    assert.deepEqual(state(run.S.history.snapshot("tok")), { owned: true, ended: undefined, text: "阳光射入水滴" });
  }));
