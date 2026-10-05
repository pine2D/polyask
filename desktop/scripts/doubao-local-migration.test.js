"use strict";
// 豆包新会话 local_ → 正式 id 的一次性迁移（history-route.js rebase()）：放行条件逐条的阴性用例，假时钟。
// 真实序列（D4 第 3 轮 Windows，2026-10-04）：local_ 上绑定 → 2.6–4.7 s 后 replace 到 /chat/<数字>
// → 315–625 ms 后用户节点被整体换掉；九站群发 t3-all9 最慢（+5.25 s replace、+0.665 s 换节点）。整链回放见 doubao-new-chat-capture.test.js。
const assert = require("node:assert/strict");
const test = require("node:test");
const { setup, node } = require("./lib/history-harness");

const LOCAL = "https://www.doubao.com/chat/local_1932321498194211";
const SERVER = "https://www.doubao.com/chat/38445524096939778";
function bound({ navigation = true } = {}) {
  const s = setup("www.doubao.com"), user = node("Question");
  if (!navigation) s.dropNavigation();
  s.navigate("https://www.doubao.com/chat/");
  s.S.history.begin("token", "Question");
  s.navigate(LOCAL);
  s.insert({ user, text: "Question", userCount: 1, answer: node("Local answer") });
  // local_ 阶段的快照已锁旧节点的回答根（e.answer 置位）：迁移须能重新确立回答根。
  assert.equal(s.S.history.snapshot("token").text, "Local answer");
  return { s, user };
}
function swap(s, user, { text = "Question", userCount = 1, key = "server-user" } = {}) {
  user.isConnected = false;
  const fresh = node(text);
  s.insert({ user: fresh, text, userCount, userKey: key, answer: node("Server answer"), answerKey: "server-reply" });
  return fresh;
}
const ended = (s) => {
  const snapshot = s.S.history.snapshot("token");
  return { owned: snapshot.owned, ended: snapshot.ended, text: snapshot.text ?? null };
};

test("Doubao local_ migration: replace to the server id then a node swap within the window keeps the copy", () => {
  const { s, user } = bound();
  s.advance(4_600); s.navigate(SERVER, { replace: true });
  s.advance(600); swap(s, user);
  const snapshot = s.S.history.snapshot("token");
  assert.deepEqual({ owned: snapshot.owned, text: snapshot.text, url: snapshot.url }, { owned: true, text: "Server answer", url: SERVER });
  assert.equal(s.S.history.submitted("token"), true);
});

test("Doubao local_ migration: the slowest real timing (9-site broadcast t3-all9, swap 5.92 s after bind) keeps the copy", () => {
  const { s, user } = bound();
  s.advance(13_931 - 8_679); s.navigate(SERVER, { replace: true });
  s.advance(14_596 - 13_931); swap(s, user);
  const snapshot = s.S.history.snapshot("token");
  assert.deepEqual({ owned: snapshot.owned, text: snapshot.text, url: snapshot.url }, { owned: true, text: "Server answer", url: SERVER });
});

test("Doubao local_ migration: the route lock alone (node kept) also settles, and a later swap is still allowed once", () => {
  const { s, user } = bound();
  s.advance(3_000); s.navigate(SERVER, { replace: true });
  assert.equal(s.S.history.snapshot("token").text, "Local answer", "replace 后节点还在：副本照旧");
  s.advance(500); const migrated = swap(s, user);
  assert.equal(s.S.history.snapshot("token").text, "Server answer");
  // 第二次换节点（同文、单轮、不同 key）：只迁移一次。
  s.advance(100); swap(s, migrated, { key: "another" });
  assert.deepEqual(ended(s), { owned: false, ended: true, text: null });
});

const negatives = {
  "a push (sidebar opens another conversation) to a numeric chat id": (s, user) => { s.navigate(SERVER); swap(s, user); },
  "a replace after the window": (s, user) => { s.advance(10_001); s.navigate(SERVER, { replace: true }); swap(s, user); },
  "a node swap after the window": (s, user) => { s.advance(4_000); s.navigate(SERVER, { replace: true }); s.advance(6_001); swap(s, user); },
  "a replace to a non-numeric path": (s, user) => { s.navigate("https://www.doubao.com/chat/abc", { replace: true }); swap(s, user); },
  "a replace back to another local_ id": (s, user) => { s.navigate("https://www.doubao.com/chat/local_1", { replace: true }); swap(s, user); },
  "a swapped node with different text": (s, user) => { s.navigate(SERVER, { replace: true }); swap(s, user, { text: "Other question" }); },
  "a swapped node in a two-turn conversation": (s, user) => { s.navigate(SERVER, { replace: true }); swap(s, user, { userCount: 2 }); },
  "a second route change after migrating": (s, user) => { s.navigate(SERVER, { replace: true }); swap(s, user); s.navigate("https://www.doubao.com/chat/38445524096939779", { replace: true }); },
};
for (const [name, act] of Object.entries(negatives)) test(`Doubao local_ migration ends the copy on ${name}`, () => {
  const { s, user } = bound();
  act(s, user);
  assert.deepEqual(ended(s), { owned: false, ended: true, text: null });
});

test("Doubao local_ migration fails closed without the Navigation API", () => {
  const { s, user } = bound({ navigation: false });
  s.navigate(SERVER, { replace: true });
  swap(s, user);
  assert.deepEqual(ended(s), { owned: false, ended: true, text: null });
});

test("Doubao local_ migration defers (attributes nothing) while the swapped turn is not located yet", () => {
  const { s, user } = bound();
  s.navigate(SERVER, { replace: true });
  user.isConnected = false;
  s.set(null);
  assert.deepEqual(ended(s), { owned: false, ended: false, text: null }, "重渲染中：不归属、也不结束");
  s.advance(400);
  s.insert({ user: node("Question"), text: "Question", userCount: 1, userKey: "server-user", answer: node("Server answer"), answerKey: "server-reply" });
  assert.equal(s.S.history.snapshot("token").text, "Server answer");
});
