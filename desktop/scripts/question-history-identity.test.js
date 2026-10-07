const assert = require("node:assert/strict");
const test = require("node:test");
const { replayFixture, replayHtml } = require("./lib/dom-replay");
const { setup, node } = require("./lib/history-harness");

for (const [fixture, attribute] of [["claude-single-turn", "data-turn-key"],
  ["chatgpt-single-turn", "data-content-search-unit-key"], ["deepseek-single-turn", "data-virtual-list-item-key"]]) {
  test(`${fixture}: user identity comes from the captured message wrapper`, () => {
    const r = replayFixture(fixture);
    try {
      const turn = r.adapter.historyTurn();
      const wrapper = turn.user.closest(`[${attribute}]`);
      assert.ok(wrapper, "the independently captured wrapper exists");
      assert.equal(turn.userKey, wrapper.getAttribute(attribute));
      assert.ok(turn.answerKey);
    } finally { r.close(); }
  });
}

test("a bound keyed turn survives virtualized counts and both message nodes remounting", () => {
  const { S, set, insert } = setup("deepseek.com");
  const old = node("old"), user = node("Question"), answer = node("First");
  set({ user: old, userCount: 4, userKey: "u-old" });
  S.history.begin("token", "Question");
  insert({ user, userCount: 5, userKey: "u-new", answer, answerKey: "a-new", text: "Question" });
  assert.equal(S.history.snapshot("token").text, "First");
  old.isConnected = false; user.isConnected = false; answer.isConnected = false;
  set({ user: node("Question"), userCount: 1, userKey: "u-new", answer: node("First and final"), answerKey: "a-new", text: "Question" });
  assert.equal(S.history.snapshot("token").text, "First and final");
  assert.equal(S.history.snapshot("token").ended, undefined);
});

test("a recycled node with a different stable key cannot retain ownership", () => {
  const { S, insert, set } = setup("deepseek.com");
  const user = node("Question"), answer = node("First");
  S.history.begin("token", "Question");
  insert({ user, userCount: 1, userKey: "u-new", answer, answerKey: "a-new", text: "Question" });
  S.history.snapshot("token");
  set({ user, userCount: 1, userKey: "u-other", answer, answerKey: "a-other", text: "Question" });
  assert.equal(S.history.snapshot("token").owned, false);
  assert.equal(S.history.snapshot("token").ended, true);
});

test("a different keyed user remount cannot replace a bound turn before its first answer", () => {
  const { S, insert, set } = setup("deepseek.com");
  const user = node("Question");
  S.history.begin("token", "Question");
  insert({ user, userCount: 1, userKey: "fresh-user", text: "Question", answer: null });
  assert.equal(S.history.snapshot("token").owned, true);
  user.isConnected = false;
  set({ user: node("Question"), userCount: 1, userKey: "old-other-user", text: "Question", answer: node("Old answer"), answerKey: "old-answer" });
  const value = S.history.snapshot("token");
  assert.equal(value.owned, false);
  assert.equal(value.ended, true);
  assert.equal(value.text, undefined);
});

test("draft input after generation leaves the bound answer readable for the final re-read", () => {
  const r = setup();
  r.S.history.begin("token", "Question");
  r.insert({ user: node("Question"), userCount: 1, answer: node("Final"), text: "Question" });
  r.S.history.snapshot("token");
  r.S.adapters["example.test"].generation = () => "complete";
  r.advance(4000); r.input();
  assert.equal(r.S.history.snapshot("token").ended, undefined);
  assert.equal(r.S.history.snapshot("token").text, "Final");
});

test("Claude body fallback stays inside the assistant turn and excludes thinking", () => {
  const r = replayHtml('<div data-turn-key="u"><div data-testid="user-message">Question</div></div>'
    + '<div data-testid="assistant-message" data-turn-key="a"><details class="thinking"><div class="standard-markdown">Private thought</div></details>'
    + '<div class="standard-markdown"><p>Final body</p></div></div>', {host:"claude.ai",path:"/chat/one"});
  try {
    const turn = r.adapter.historyTurn();
    assert.equal(turn.locate, "selector");
    assert.equal(turn.answer?.textContent, "Final body");
    turn.answer.remove();
    assert.equal((r.adapter.historyTurn().answer) === (null), true);
  } finally { r.close(); }
});

test("DeepSeek witnessed append binds even when the previous virtual slots leave in the same batch", async () => {
  const r = replayHtml('<div id="list"><div data-virtual-list-item-key="u-old"><div class="ds-message"><div class="ds-collapsible-text">Old</div></div></div>'
    + '<div data-virtual-list-item-key="a-old"><div class="ds-message"><div class="ds-markdown">Old answer</div></div></div></div>', {host:"chat.deepseek.com",path:"/a/chat/one"});
  try {
    r.S.history.begin("token", "Question");
    const list = r.document.getElementById("list");
    list.insertAdjacentHTML("beforeend", '<div data-virtual-list-item-key="u-new"><div class="ds-message"><div class="ds-collapsible-text">Question</div></div></div>');
    list.firstElementChild.remove(); list.firstElementChild.remove();
    list.insertAdjacentHTML("beforeend", '<div data-virtual-list-item-key="a-new"><div class="ds-message"><div class="ds-markdown">Fresh answer</div></div></div>');
    await new Promise(resolve => r.window.setTimeout(resolve, 0));
    assert.equal(r.S.history.snapshot("token").owned, true);
    assert.equal(r.S.history.snapshot("token").text, "Fresh answer");
  } finally { r.close(); }
});

test("DeepSeek old slots remounted without a witnessed append remain unowned", async () => {
  const r = replayHtml('<div id="list"><div data-virtual-list-item-key="u-old"><div class="ds-message"><div class="ds-collapsible-text">Old</div></div></div>'
    + '<div data-virtual-list-item-key="a-old"><div class="ds-message"><div class="ds-markdown">Old answer</div></div></div></div>', {host:"chat.deepseek.com",path:"/a/chat/one"});
  try {
    r.S.history.begin("token", "Question");
    r.document.getElementById("list").innerHTML = '<div data-virtual-list-item-key="u-older"><div class="ds-message"><div class="ds-collapsible-text">Question</div></div></div>'
      + '<div data-virtual-list-item-key="a-older"><div class="ds-message"><div class="ds-markdown">Wrong answer</div></div></div>';
    await new Promise(resolve => r.window.setTimeout(resolve, 0));
    const v = r.S.history.snapshot("token");
    assert.equal(v.owned, false); assert.equal(v.text, undefined);
    assert.equal(v.captureCode, "turn_unconfirmed");
  } finally { r.close(); }
});

test("DeepSeek cannot use a recycled predecessor with a different key as append evidence", async () => {
  const r = replayHtml('<div id="list"><div data-virtual-list-item-key="u-old"><div class="ds-message"><div class="ds-collapsible-text">Old</div></div></div>'
    + '<div data-virtual-list-item-key="a-old"><div class="ds-message"><div class="ds-markdown">Old answer</div></div></div></div>', {host:"chat.deepseek.com",path:"/a/chat/one"});
  try {
    r.S.history.begin("token", "Question");
    const list = r.document.getElementById("list");
    list.firstElementChild.remove();
    list.firstElementChild.setAttribute("data-virtual-list-item-key", "a-older");
    list.insertAdjacentHTML("beforeend", '<div data-virtual-list-item-key="u-older"><div class="ds-message"><div class="ds-collapsible-text">Question</div></div></div>'
      + '<div data-virtual-list-item-key="a-older-reply"><div class="ds-message"><div class="ds-markdown">Wrong answer</div></div></div>');
    await new Promise(resolve => r.window.setTimeout(resolve, 0));
    const value = r.S.history.snapshot("token");
    assert.equal(value.owned, false);
    assert.equal(value.text, undefined);
  } finally { r.close(); }
});
