// 离线 DOM 回放：脱敏 fixture 装进 jsdom，跑 preload 真实注入链上的生产 site-runtime，
// 用采集时标记的 data-polyask-expect 节点对账 historyTurn()。新入库的 fixture 自动纳入下面的逐个用例。
const assert = require("node:assert/strict");
const test = require("node:test");
const { JSDOM } = require("jsdom");
const { listFixtures, loadFixture, replayFixture, replayHtml } = require("./lib/dom-replay");
const { sanitizeDomFixture, elementPath } = require("./lib/dom-fixture-sanitize");
const { scanHtml } = require("./lib/dom-fixture-scan");

const marked = (document, token) => document.querySelector(`[data-polyask-expect~="${token}"]`);

for (const name of listFixtures()) {
  test(`fixture ${name}: production historyTurn binds the marked user and answer`, () => {
    const run = replayFixture(name);
    try {
      const { expect } = run.meta;
      assert.equal(typeof run.adapter?.historyTurn, "function", `${run.meta.host} 没有 historyTurn`);
      const turn = run.adapter.historyTurn();
      assert.equal(turn.userCount, expect.userCount);
      if (expect.userText === null) assert.equal(turn.user, null);
      else {
        assert.equal(turn.user, marked(run.document, "user"));
        assert.equal(turn.text.replace(/\s+/g, " ").trim(), expect.userText.replace(/\s+/g, " "));
      }
      assert.equal(turn.answer ?? null, expect.answer ? marked(run.document, "answer") : null);
      if (expect.answerRoot) assert.equal(turn.answerRoot, marked(run.document, "answer-root"));
      // 采集时没有 ③ 级的问题原文上下文，historyTurn() 只会给出 ① 或 ② 级；记了 locate 就逐个核对。
      if (expect.locate) assert.equal(turn.locate, expect.locate);
    } finally { run.close(); }
  });
}

test("synthetic Kimi fixture: thinking section is excluded and both copy paths read the same answer", async () => {
  const run = replayFixture("kimi-synthetic");
  try {
    const expected = "lorem ipsum dolor sit amet\n\n- lorem ipsum\n- dolor sit";
    assert.equal(run.S.toMarkdown(run.adapter.historyTurn().answer), expected);
    const summary = await run.send({ source: "AMS", cmd: "collectAnswer" });
    assert.equal(summary.text, expected, "core.js collectAnswer 与历史副本应读同一节点");
  } finally { run.close(); }
});

test("history begin/snapshot runs against jsdom MutationObserver on a replayed conversation", async () => {
  const fixture = loadFixture("kimi-synthetic");
  const run = replayFixture(fixture);
  try {
    const list = run.document.querySelector(".chat-content-list");
    const pending = [marked(run.document, "user"), marked(run.document, "answer-root")];
    for (const node of pending) node.remove();
    run.S.history.begin("tok-1", fixture.meta.expect.userText, Date.now() + 44_000);
    assert.equal(run.S.history.snapshot("tok-1").owned, false, "新轮次插入前不得归属旧回答");
    for (const node of pending) list.append(node);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const snapshot = run.S.history.snapshot("tok-1");
    assert.equal(snapshot.owned, true);
    assert.match(snapshot.text, /^lorem ipsum dolor sit amet\n\n- lorem ipsum/);
    assert.equal(snapshot.url, `https://${fixture.meta.host}${fixture.meta.path}`);
  } finally { run.close(); }
});

test("sanitizer output of a raw page passes the scan and still replays through production selectors", () => {
  const raw = new JSDOM(`<!doctype html><body><nav><a href="https://www.kimi.com/chat/abc">My secret title</a></nav>
    <main id="app-root-0f8fad5b"><div class="chat-content-list">
      <div class="chat-content-item chat-content-item-user" data-message-id="0f8fad5b-d9cb-469f-a165-70867728950e">
        <div class="user-content">Earlier private question</div></div>
      <div class="chat-content-item chat-content-item-assistant" data-message-id="msg-777"><div class="markdown"><p>Earlier answer</p></div></div>
      <div class="chat-content-item chat-content-item-user" data-message-id="msg-778" data-group="g-1" style="color:red">
        <div class="user-content">What is   the capital of France?</div></div>
      <div class="chat-content-item chat-content-item-assistant" data-group="g-1" data-is-streaming="false">
        <div class="markdown" aria-label="Answer from Kimi"><p>Paris, contact me at a@b.example or https://x.example</p>
          <span style="display:none">hidden watermark 1234567890abcdef1234567890abcdef</span>
          <svg viewBox="0 0 1 1"><path d="M0 0h1v1z"></path></svg>
          <script>alert(1)</script></div></div>
    </div></main></body>`, { url: "https://www.kimi.com/chat/abc" });
  const { document } = raw.window;
  const root = document.body;
  const user = document.querySelectorAll(".chat-content-item-user")[1], answer = document.querySelectorAll(".markdown")[1];
  const { html, stats } = sanitizeDomFixture(root, { prompt: "What is the capital of France?", promptToken: "POLYASK_PROMPT",
    marks: [{ path: elementPath(root, user), token: "user" }, { path: elementPath(root, answer), token: "answer" }] });
  raw.window.close();
  assert.deepEqual(scanHtml(html, "POLYASK_PROMPT"), []);
  assert.equal(stats.promptHits, 1);
  assert.equal(stats.marked, 2);
  for (const leak of ["France", "Paris", "secret", "private", "href", "style", "alert", "path", "watermark", "Answer from", "0f8fad5b"]) {
    assert.ok(!html.includes(leak), `泄露: ${leak}`);
  }
  assert.equal((html.match(/data-group="id-\d+"/g) || []).length, 2);
  assert.equal(new Set(html.match(/data-group="id-\d+"/g)).size, 1, "同值 data-* 必须映射到同一占位，保住 key 相等语义");
  assert.match(html, /data-is-streaming="false"/);
  assert.match(html, /<span hidden>/, "display:none 节点要补 hidden，回放时 md.js 才会剔除");
  assert.match(html, /aria-label="label-1"/);
  assert.match(html, /<svg><\/svg>/);
  const run = replayHtml(html, { host: "www.kimi.com", path: "/chat/id-1" });
  try {
    const turn = run.adapter.historyTurn();
    assert.equal(turn.userCount, 2);
    assert.equal(turn.user, marked(run.document, "user"));
    assert.equal(turn.text, "POLYASK_PROMPT");
    assert.equal(turn.answer, marked(run.document, "answer"));
    assert.equal(turn.userKey, "id-3");
    // 隐藏水印经 hidden 被 md.js 剔除：正文只剩段落占位一行。
    assert.equal(run.S.toMarkdown(turn.answer), "lorem ipsum dolor sit amet consectetur a");
  } finally { run.close(); }
});
