"use strict";
// history.js 与定位级别的契约：begin() 建立并冻结 ctx、锚点资格、locate 透传、锚点不作新消息证据、无 key 锚点根只读一次。
const assert = require("node:assert/strict");
const test = require("node:test");
const { setup, node } = require("./lib/history-harness");

test("begin builds one locate ctx and every later historyTurn of the entry reuses it", () => {
  const s = setup();
  s.set({ user: node("Earlier"), text: "Earlier", userCount: 1, locate: "semantic" });
  s.S.history.begin("token", "Question");
  const ctx = s.contexts[0];
  assert.equal(ctx.text, "Question");
  assert.equal(ctx.anchor, false, "已有轮次的会话不给锚点资格");
  s.insert({ user: node("Question"), text: "Question", answer: node("Answer"), userCount: 2, locate: "semantic" });
  s.S.history.snapshot("token");
  s.S.history.submitted("token");
  assert.ok(s.contexts.length >= 4);
  assert.ok(s.contexts.every(value => value === ctx), "begin、observer、snapshot、submitted 必须用同一个冻结的 ctx");
});

test("anchor eligibility: home route, no baseline user and no attachments", () => {
  const home = setup("example.test", "https://example.test/");
  home.S.history.begin("token", "Question");
  assert.equal(home.contexts.at(-1).anchor, true);
  const images = setup("example.test", "https://example.test/");
  images.S.history.begin("token", "Question", undefined, { images: 1 });
  assert.equal(images.contexts.at(-1).anchor, false);
  const conversation = setup();
  conversation.S.history.begin("token", "Question");
  assert.equal(conversation.contexts.at(-1).anchor, false, "会话路由上即使选择器零命中也可能是老会话");
  const existing = setup("example.test", "https://example.test/");
  existing.set({ user: node("Earlier"), text: "Earlier", userCount: 1 });
  existing.S.history.begin("token", "Question");
  assert.equal(existing.contexts.at(-1).anchor, false);
});

test("owned snapshots carry the turn's locate level", () => {
  const s = setup();
  s.S.history.begin("token", "Question");
  s.insert({ user: node("Question"), text: "Question", answer: node("Answer"), answerKey: "a", userCount: 1, locate: "semantic" });
  const snapshot = s.S.history.snapshot("token");
  assert.equal(snapshot.owned, true);
  assert.equal(snapshot.locate, "semantic");
});

test("an anchor-located turn binds but never counts as submission message evidence", () => {
  const s = setup("example.test", "https://example.test/");
  s.S.history.begin("token", "Question");
  s.insert({ user: node("Question"), text: "Question", userCount: 1, locate: "anchor" });
  assert.equal(s.S.history.submitted("token"), false);
  assert.equal(s.S.history.snapshot("token").owned, true, "归属照常成立，只是不当新消息证据");
  const semantic = setup();
  semantic.S.history.begin("token", "Question");
  semantic.insert({ user: node("Question"), text: "Question", userCount: 1, locate: "semantic" });
  assert.equal(semantic.S.history.submitted("token"), true);
});

test("an anchor answer root without a stable key is read once after streaming and then ends", () => {
  const s = setup("example.test", "https://example.test/");
  const answer = node("Partial"), root = { ...node("root"), contains: (other) => other === answer || other === root };
  s.S.history.begin("token", "Question");
  s.insert({ user: node("Question"), text: "Question", answer, answerRoot: root, userCount: 1, locate: "anchor" });
  const streaming = s.S.history.snapshot("token");
  assert.equal(streaming.owned, true);
  assert.equal(streaming.text, undefined);
  assert.equal(streaming.generation, "generating");
  s.S.adapters["example.test"].generation = () => null;
  answer.text = "Final";
  assert.equal(s.S.history.snapshot("token").text, undefined, "回答根从没被观察到变动（changedAt 为空）时不读：静止根多半是回显");
  s.mutate([{ target: answer, addedNodes: [] }]);
  assert.equal(s.S.history.snapshot("token").text, undefined, "变动后 2 秒内不读");
  s.advance(2_100);
  const final = s.S.history.snapshot("token");
  assert.deepEqual({ text: final.text, ended: final.ended, locate: final.locate }, { text: "Final", ended: true, locate: "anchor" });
  answer.text = "Changed later";
  assert.equal(s.S.history.snapshot("token").text, "Final");
});

test("an anchor answer root with a stable key is locked like any other root", () => {
  const s = setup("example.test", "https://example.test/");
  const user = node("Question");
  s.S.history.begin("token", "Question");
  s.insert({ user, text: "Question", answer: node("First"), answerKey: "a-1", userCount: 1, locate: "anchor" });
  assert.equal(s.S.history.snapshot("token").text, "First", "带 key 的根生成中也逐次读取");
  s.set({ user, text: "Question", answer: node("Other"), answerKey: "a-2", userCount: 1, locate: "anchor" });
  assert.equal(s.S.history.snapshot("token").ended, true, "换了回答根即停止");
});
