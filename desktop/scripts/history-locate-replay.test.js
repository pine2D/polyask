"use strict";
// 历史副本第 ②③ 级定位（site-runtime/history-locate.js）在 jsdom 里跑整条 preload 链的回放用例。
// 页面一律是手写合成 DOM：类名故意不等于任何站点的第 ① 级选择器（模拟改版后选择器整组零命中）。
const assert = require("node:assert/strict");
const test = require("node:test");
const { replayHtml } = require("./lib/dom-replay");

const PROMPT = "What is the capital of France?";
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const SIDEBAR = `<aside class="drawer"><div class="item">${PROMPT}</div></aside>`;
const COMPOSER = '<div class="composer-box"><div class="editor" contenteditable="true" role="textbox"></div></div>';
function page(list, { sidebar = SIDEBAR, composer = COMPOSER } = {}) {
  return `${sidebar}<main class="shell"><div class="scroller"><div class="thread">${list}</div></div>${composer}</main>`;
}
function turnHtml(prompt, answer, { userKey = "u-1", answerKey = "a-1" } = {}) {
  return `<div class="row-q"${userKey ? ` data-row-id="${userKey}"` : ""}><div class="bubble">${prompt}</div>`
    + `<div class="tools" aria-hidden="true"><button>copy</button></div></div>`
    + (answer === null ? "" : `<div class="row-a"${answerKey ? ` data-row-id="${answerKey}"` : ""}>`
    + `<div class="thought-reasoning"><div class="markdown"><p>hidden chain</p></div></div>`
    + `<div class="body"><div class="markdown"><p>${answer}</p></div></div></div>`);
}
function fragment(document, html) {
  const box = document.createElement("div");
  box.innerHTML = html;
  return [...box.children];
}
// 模拟一次提交：begin 之后把本轮用户与回答节点插进会话列表，等 MutationObserver 回调。
async function submit(run, html, { token = "tok", prompt = PROMPT, images = 0 } = {}) {
  run.S.history.begin(token, prompt, Date.now() + 44_000, { images });
  const thread = run.document.querySelector(".thread");
  for (const node of fragment(run.document, html)) thread.append(node);
  await tick();
  return run.S.history.snapshot(token);
}
function withRun(html, options, body) {
  const run = replayHtml(html, options);
  return Promise.resolve().then(() => body(run)).finally(() => run.close());
}
const KIMI_HOME = { host: "www.kimi.com", path: "/" };

test("selector drift: an empty conversation's first turn is recovered by the unique prompt anchor", () =>
  withRun(page(""), KIMI_HOME, async (run) => {
    assert.equal(run.adapter.historyTurn().user, null, "第 ① 级选择器在漂移页面上必须零命中，用例才有意义");
    const snapshot = await submit(run, turnHtml(PROMPT, "Paris"));
    assert.equal(snapshot.owned, true);
    assert.equal(snapshot.locate, "anchor");
    assert.equal(snapshot.text, "Paris", "思考段与操作按钮不得进入正文");
    assert.equal(run.S.history.submitted("tok"), false, "锚点命中不得成为 submissionEvidence=message 的证据");
    const summary = await run.send({ source: "AMS", cmd: "collectAnswer" });
    assert.equal(summary.text, null, "汇总复制路径不接原文锚点");
  }));

test("anchor ignores the sidebar title, a class-named session list and the composer that echo the prompt", () =>
  withRun(page("", {
    sidebar: `<nav><a>${PROMPT}</a></nav><div class="chat-sidebar"><div>${PROMPT}</div></div><header><h1>${PROMPT}</h1></header>`,
    composer: `<div class="composer-box"><div class="editor" contenteditable="true" role="textbox">${PROMPT}</div></div>`
  }), KIMI_HOME, async (run) => {
    const snapshot = await submit(run, turnHtml(PROMPT, "Paris"));
    assert.equal(snapshot.owned, true);
    assert.equal(snapshot.text, "Paris");
  }));

test("anchor refuses same-text duplicates inside the conversation", () =>
  withRun(page(""), KIMI_HOME, async (run) => {
    const snapshot = await submit(run, turnHtml(PROMPT, null) + `<div class="row-a" data-row-id="a-1"><div class="body"><div class="markdown"><p>${PROMPT}</p></div></div></div>`);
    assert.equal(snapshot.owned, false, "同文命中两处必须返回 null，不能取最后一个");
  }));

test("anchor is only for an empty conversation: an existing conversation route never anchors", () =>
  withRun(page(turnHtml("Earlier question", "Earlier answer", { userKey: "u-0", answerKey: "a-0" })),
    { host: "www.kimi.com", path: "/chat/id-1" }, async (run) => {
      const snapshot = await submit(run, turnHtml(PROMPT, "Paris"));
      assert.equal(snapshot.owned, false);
    }));

test("anchor is disabled for prompts with attachments", () =>
  withRun(page(""), KIMI_HOME, async (run) => {
    assert.equal((await submit(run, turnHtml(PROMPT, "Paris"), { images: 1 })).owned, false);
  }));

for (const site of [{ host: "www.doubao.com", path: "/chat/" }, { host: "yuanbao.tencent.com", path: "/chat/naQivTmsDa" }, { host: "chat.deepseek.com", path: "/" }]) {
  test(`virtual-list site ${site.host} never uses the prompt anchor`, () =>
    withRun(page(""), site, async (run) => {
      assert.equal((await submit(run, turnHtml(PROMPT, "Paris"))).owned, false);
      assert.equal(run.S.historyLocate.locate({ anchor: true, text: PROMPT }), null);
    }));
}

test("multi-line prompts anchor on the smallest common ancestor of every line", () =>
  withRun(page(""), KIMI_HOME, async (run) => {
    const prompt = "First line here\nSecond line here";
    const user = '<div class="row-q" data-row-id="u-1"><div class="lines"><div class="ln">First line here</div>\n<div class="ln">Second line here</div></div></div>';
    const answer = '<div class="row-a" data-row-id="a-1"><div class="markdown"><p>Joined</p></div></div>';
    const snapshot = await submit(run, user + answer, { prompt });
    assert.equal(snapshot.owned, true);
    assert.equal(snapshot.text, "Joined");
    assert.equal(run.adapter.historyTurn({ method: "anchor", anchor: true, text: prompt }).user, run.document.querySelector(".lines"));
  }));

test("an anchor root without a stable data key is not locked: read once after streaming, then the copy ends", () =>
  withRun(page(""), KIMI_HOME, async (run) => {
    run.adapter.generation = () => "generating";
    const first = await submit(run, turnHtml(PROMPT, "Partial", { answerKey: null }));
    assert.equal(first.owned, true);
    assert.equal(first.text, undefined, "生成中不读正文");
    assert.equal(first.generation, "generating");
    run.adapter.generation = () => null;
    run.document.querySelector(".row-a .body p").textContent = "Paris, final";
    await tick();
    const changed = run.S.history.snapshot("tok");
    assert.equal(changed.text, undefined, "回答容器 2 秒内仍有增删时也不读");
    const now = run.window.Date.now;
    run.window.Date.now = () => now() + 2_100;
    const final = run.S.history.snapshot("tok");
    assert.equal(final.text, "Paris, final");
    assert.equal(final.ended, true);
    assert.equal(final.locate, "anchor");
    run.document.querySelector(".row-a .body p").textContent = "Mutated later";
    assert.equal(run.S.history.snapshot("tok").text, "Paris, final", "只读一次：之后的改动不进副本");
  }));

const HEALTHY = `<div class="chat-content-item chat-content-item-user" data-message-id="m-1"><div class="user-content">${PROMPT}</div></div>`
  + '<div class="chat-content-item chat-content-item-assistant" data-message-id="m-2"><div class="segment-content"><div class="markdown"><p>Paris</p></div></div></div>';
const RECENT = '<div class="left-panel"><div class="recent"></div></div>';

test("an unadopted anchor hit never freezes the method: a recent-list echo outside main cannot steal a healthy level-one turn", async () => {
  for (const older of [0, 1, 2]) {
    await withRun(page("", { sidebar: RECENT }), KIMI_HOME, async (run) => {
      run.S.history.begin("tok", PROMPT, Date.now() + 44_000, { images: 0 });
      // 气泡出现之前，类名不带 sidebar、也不在 nav/aside 里的「最近记录」先插入以问题原文为标题的条目。
      const items = `<div class="item">${PROMPT}</div>` + Array.from({ length: older }, (_, i) => `<div class="item">Older chat ${i}</div>`).join("");
      for (const node of fragment(run.document, items)) run.document.querySelector(".recent").append(node);
      await tick();
      for (const node of fragment(run.document, HEALTHY)) run.document.querySelector(".thread").append(node);
      await tick();
      const snapshot = run.S.history.snapshot("tok");
      assert.deepEqual({ owned: snapshot.owned, locate: snapshot.locate, text: snapshot.text }, { owned: true, locate: "selector", text: "Paris" }, `older=${older}`);
    });
  }
});

test("a pre-existing same-text node that fails bind does not lock the turn onto the anchor", async () => {
  // 一处在 main 外的最近记录；一处在 main 内的首页建议卡片（锚点唯一命中它、但它不是本轮插入的，bind 不收）。
  for (const html of [page("", { sidebar: `<div class="left-panel"><div class="recent"><div class="item">${PROMPT}</div></div></div>` }),
    page(`<div class="suggest">${PROMPT}</div>`)]) {
    await withRun(html, KIMI_HOME, async (run) => {
      run.S.history.begin("tok", PROMPT, Date.now() + 44_000, { images: 0 });
      run.document.querySelector(".editor").textContent = PROMPT;
      await tick();
      for (const node of fragment(run.document, HEALTHY)) run.document.querySelector(".thread").append(node);
      await tick();
      const snapshot = run.S.history.snapshot("tok");
      assert.equal(snapshot.locate, "selector");
      assert.equal(snapshot.text, "Paris");
    });
  }
});

test("anchor only counts same-text nodes in the composer's main region, or horizontally overlapping it when layout is measurable", () =>
  withRun(page("", { sidebar: `<div class="recent"><div class="item">${PROMPT}</div></div>` }), KIMI_HOME, async (run) => {
    const ctx = () => ({ method: "anchor", anchor: true, text: PROMPT, cache: null });
    for (const node of fragment(run.document, turnHtml(PROMPT, "Paris"))) run.document.querySelector(".thread").append(node);
    assert.equal(run.adapter.historyTurn(ctx()).user, run.document.querySelector(".bubble"), "main 外的同文不计数，main 内唯一命中");
    run.document.querySelector("main").replaceWith(...run.document.querySelector("main").childNodes);
    assert.equal(run.adapter.historyTurn(ctx()).user, null, "没有 main、也量不到布局：两处同文 = 歧义");
    const rect = (left, right) => () => ({ left, right, width: right - left, top: 0, bottom: 10, height: 10 });
    run.document.querySelector(".editor").getBoundingClientRect = rect(300, 900);
    run.document.querySelector(".recent .item").getBoundingClientRect = rect(0, 260);
    run.document.querySelector(".bubble").getBoundingClientRect = rect(600, 880);
    assert.equal(run.adapter.historyTurn(ctx()).user, run.document.querySelector(".bubble"), "与输入框水平不重叠的同文（侧栏）不计数");
  }));

test("a keyless anchor root is never sealed by quiet alone: no stop-control evidence means read once at the soft expiry", () =>
  withRun(page(""), KIMI_HOME, async (run) => {
    run.adapter.generation = () => null;
    const first = await submit(run, turnHtml(PROMPT, "Par", { answerKey: null }));
    assert.equal(first.owned, true);
    assert.equal(first.text, undefined, "停止键从没亮过：静止不是完成证据");
    const now = run.window.Date.now;
    run.window.Date.now = () => now() + 10_000;
    assert.equal(run.S.history.snapshot("tok").ended, undefined, "10 秒静止也不封存");
    run.window.Date.now = now;
    run.S.history.begin("tok2", PROMPT, 1, { images: 0 });
    run.document.querySelector(".thread").replaceChildren(...fragment(run.document, turnHtml(PROMPT, "Paris, final", { answerKey: null })));
    await tick();
    const final = run.S.history.snapshot("tok2");
    assert.deepEqual({ text: final.text, ended: final.ended, locate: final.locate }, { text: "Paris, final", ended: true, locate: "anchor" },
      "软到期（主进程观察窗收口前）降级读一次");
  }));

test("anchor ownership guards: a following turn stops the copy", () =>
  withRun(page(""), KIMI_HOME, async (run) => {
    assert.equal((await submit(run, turnHtml(PROMPT, "Paris"))).text, "Paris");
    const thread = run.document.querySelector(".thread");
    for (const node of fragment(run.document, turnHtml("Follow up", "More", { userKey: "u-2", answerKey: "a-2" }))) thread.append(node);
    const after = run.S.history.snapshot("tok");
    assert.equal(after.owned, false);
    assert.equal(after.ended, true);
  }));

test("anchor ownership guards: a replaced answer root stops the copy", () =>
  withRun(page(""), KIMI_HOME, async (run) => {
    assert.equal((await submit(run, turnHtml(PROMPT, "Paris"))).text, "Paris");
    const old = run.document.querySelector(".row-a");
    const [replacement] = fragment(run.document, '<div class="row-a" data-row-id="a-9"><div class="markdown"><p>Other</p></div></div>');
    old.replaceWith(replacement);
    assert.equal(run.S.history.snapshot("tok").ended, true);
  }));

test("anchor ownership guards: leaving the bound conversation route stops the copy", () =>
  withRun(page(""), KIMI_HOME, async (run) => {
    assert.equal((await submit(run, turnHtml(PROMPT, "Paris"))).text, "Paris");
    run.window.history.pushState(null, "", "/chat/first-id");
    assert.equal(run.S.history.snapshot("tok").text, "Paris", "首页首轮拿到会话地址是正常迁移");
    run.window.history.pushState(null, "", "/chat/another-id");
    assert.equal(run.S.history.snapshot("tok").ended, true);
  }));

const semanticTurn = (prompt, answer, n) => `<div class="q-row" data-message-author-role="user" data-message-id="su-${n}"><p>${prompt}</p></div>`
  + `<div class="a-row" data-message-author-role="assistant" data-message-id="sa-${n}"><div class="markdown"><p>${answer}</p></div></div>`;

test("selector drift in an existing conversation is recovered by semantic signals, frozen at begin", () =>
  withRun(page(semanticTurn("Earlier question", "Earlier answer", 0)), { host: "www.kimi.com", path: "/chat/id-1" }, async (run) => {
    const ctx = { method: null };
    assert.equal(run.adapter.historyTurn(ctx).locate, "semantic");
    assert.equal(ctx.method, null, "historyTurn 只定位不冻结：冻结只在 begin 的基线命中或 bind 首次确立用户时发生");
    run.S.history.begin("tok", PROMPT, Date.now() + 44_000);
    // begin 之后旧轮次补上第 ① 级类名、又插入只带第 ① 级类名的同文轮次：按选择器数正好是「基线 + 1」，
    // 但方法已冻结为语义级，不得中途切到选择器把它当成本轮。
    const thread = run.document.querySelector(".thread");
    thread.firstElementChild.classList.add("chat-content-item", "chat-content-item-user");
    const noise = fragment(run.document, `<div class="chat-content-item chat-content-item-user"><div class="user-content">${PROMPT}</div></div>`
      + '<div class="chat-content-item chat-content-item-assistant"><div class="segment-content"><div class="markdown"><p>Noise</p></div></div></div>');
    for (const node of noise) thread.append(node);
    await tick();
    assert.equal(run.adapter.historyTurn().userCount, 2, "噪声确实让第 ① 级数到基线 + 1，用例才有意义");
    assert.equal(run.S.history.snapshot("tok").owned, false);
    for (const node of noise) node.remove();
    for (const node of fragment(run.document, semanticTurn(PROMPT, "Paris", 1))) thread.append(node);
    await tick();
    const snapshot = run.S.history.snapshot("tok");
    assert.equal(snapshot.owned, true);
    assert.equal(snapshot.locate, "semantic");
    assert.equal(snapshot.text, "Paris");
    assert.equal(run.S.history.submitted("tok"), true, "语义级按真实轮次计数，可作新消息证据");
    for (const node of fragment(run.document, semanticTurn("Follow up", "More", 2))) thread.append(node);
    assert.equal(run.S.history.snapshot("tok").ended, true, "多出一个新轮次即停止");
  }));

test("healthy selectors stay on level one and report locate=selector", () =>
  withRun(page(""), { host: "www.kimi.com", path: "/chat/id-1" }, async (run) => {
    const html = `<div class="chat-content-item chat-content-item-user" data-message-id="m-1"><div class="user-content">${PROMPT}</div></div>`
      + '<div class="chat-content-item chat-content-item-assistant" data-message-id="m-2"><div class="segment-content"><div class="markdown"><p>Paris</p></div></div></div>';
    const snapshot = await submit(run, html);
    assert.equal(snapshot.owned, true);
    assert.equal(snapshot.locate, "selector");
    assert.equal(snapshot.text, "Paris");
  }));

test("diagnose capture probe: level-one hits on a conversation route, advisory red on drift, silent at home", () => {
  const healthy = `<div class="chat-content-item chat-content-item-user" data-message-id="m-1"><div class="user-content">${PROMPT}</div></div>`
    + '<div class="chat-content-item chat-content-item-assistant" data-message-id="m-2"><div class="segment-content"><div class="markdown"><p>Paris</p></div></div></div>';
  const probe = (html, path) => {
    const run = replayHtml(page(html), { host: "www.kimi.com", path });
    try { return JSON.parse(JSON.stringify(run.adapter.diagnose().filter((check) => check.kind === "capture").map(({ name, ok }) => ({ name, ok })))); } finally { run.close(); }
  };
  assert.deepEqual(probe(healthy, "/chat/id-1"), [{ name: "Question located", ok: true }, { name: "Answer located", ok: true }]);
  assert.deepEqual(probe(turnHtml(PROMPT, "Paris"), "/chat/id-1"), [{ name: "Question located", ok: false }, { name: "Answer located", ok: false }],
    "只有 ②③ 级接得住时探针也必须记红");
  assert.deepEqual(probe("", "/"), []);
});
