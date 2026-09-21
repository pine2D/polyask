const assert = require("node:assert/strict");
const test = require("node:test");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");
function setup() {
  let turn = null, mutated = () => {};
  const adapter = { historyTurn: () => turn, generation: () => "generating" };
  const S = { adapters: { "example.test": adapter }, toMarkdown: node => node.text };
  const context = { setTimeout: () => 1, clearTimeout: () => {}, document: { documentElement: {} }, MutationObserver: class { constructor(callback) { mutated = callback; } observe() {} disconnect() {} }, window: { __AMS: S }, location: { hostname: "example.test", href: "https://example.test/chat/one" } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../src/site-runtime/history.js"), "utf8"), context);
  return { S, set: value => { turn = value; }, insert: value => { turn = value; mutated([{ addedNodes: [value.user] }]); } };
}
const node = (text) => ({ text, isConnected: true });
test("history capture refuses old answers and binds only a new matching user turn", () => {
  const s = setup(), oldUser = node("Question"), oldAnswer = node("Old");
  s.set({ user: oldUser, answer: oldAnswer, text: "Question", userCount: 1 });
  s.S.history.begin("token", "Question");
  assert.equal(s.S.history.snapshot("token").owned, false);
  s.set({ user: node("Question"), answer: node("New"), text: "Question", userCount: 2 });
  const result = s.S.history.snapshot("token");
  assert.equal(result.owned, true);
  assert.equal(result.text, "New");
  assert.equal(s.S.history.snapshot("other").owned, false);
});
test("detached baseline and later manual follow-ups fail closed", () => {
  const s = setup(), baseline = node("Earlier");
  s.set({ user: baseline, answer: node("Old"), text: "Earlier", userCount: 1 });
  s.S.history.begin("token", "Question");
  baseline.isConnected = false;
  s.set({ user: node("Question"), answer: node("Wrong"), text: "Question", userCount: 2 });
  assert.equal(s.S.history.snapshot("token").owned, false);
  s.set(null); s.S.history.begin("second", "Question");
  const user = node("Question");
  s.insert({ user, answer: node("Right"), text: "Question", userCount: 1 });
  assert.equal(s.S.history.snapshot("second").text, "Right");
  s.set({ user: node("Next"), answer: node("Wrong"), text: "Next", userCount: 2 });
  assert.equal(s.S.history.snapshot("second").ended, true);
});
test('an empty baseline without an observed new user insertion cannot bind an old matching turn', () => {
  const s = setup();
  s.S.history.begin('token', 'Question');
  s.set({ user: node('Question'), answer: node('Old'), text: 'Question', userCount: 1 });
  assert.equal(s.S.history.snapshot('token').owned, false);
});
test('a same-text manual follow-up before the first poll is not the submitted turn', () => {
  const s = setup();
  s.set({ user: node('Earlier'), text: 'Earlier', userCount: 1 });
  s.S.history.begin('token', 'Question');
  s.set({ user: node('Question'), text: 'Question', answer: node('Manual follow-up'), userCount: 3 });
  assert.equal(s.S.history.snapshot('token').owned, false);
});
test('a completed answer cannot be replaced by regeneration in the same DOM node', () => {
  const s = setup();
  s.set({ user: node('Earlier'), text: 'Earlier', userCount: 1 });
  s.S.adapters['example.test'].generation = () => 'complete';
  s.S.history.begin('token', 'Question');
  const answer = node('Original');
  s.set({ user: node('Question'), text: 'Question', answer, userCount: 2 });
  assert.equal(s.S.history.snapshot('token').text, 'Original');
  answer.text = 'Regenerated';
  assert.equal(s.S.history.snapshot('token').owned, false);
});
