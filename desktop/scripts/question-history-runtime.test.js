const assert = require("node:assert/strict");
const test = require("node:test");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");
function setup() {
  let turn = null;
  const adapter = { historyTurn: () => turn, generation: () => "generating" };
  const S = { adapters: { "example.test": adapter }, toMarkdown: node => node.text };
  const context = { window: { __AMS: S }, location: { hostname: "example.test", href: "https://example.test/chat/one" } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../src/site-runtime/history.js"), "utf8"), context);
  return { S, set: value => { turn = value; } };
}
const node = (text) => ({ text, isConnected: true });
test("history capture refuses old answers and binds only a new matching user turn", () => {
  const s = setup(), oldUser = node("Question"), oldAnswer = node("Old");
  s.set({ user: oldUser, answer: oldAnswer, text: "Question" });
  s.S.history.begin("token", "Question");
  assert.equal(s.S.history.snapshot("token").owned, false);
  s.set({ user: node("Question"), answer: node("New"), text: "Question" });
  const result = s.S.history.snapshot("token");
  assert.equal(result.owned, true);
  assert.equal(result.text, "New");
  assert.equal(s.S.history.snapshot("other").owned, false);
});
test("detached baseline and later manual follow-ups fail closed", () => {
  const s = setup(), baseline = node("Earlier");
  s.set({ user: baseline, answer: node("Old"), text: "Earlier" });
  s.S.history.begin("token", "Question");
  baseline.isConnected = false;
  s.set({ user: node("Question"), answer: node("Wrong"), text: "Question" });
  assert.equal(s.S.history.snapshot("token").owned, false);
  s.set(null); s.S.history.begin("second", "Question");
  const user = node("Question");
  s.set({ user, answer: node("Right"), text: "Question" });
  assert.equal(s.S.history.snapshot("second").text, "Right");
  s.set({ user: node("Next"), answer: node("Wrong"), text: "Next" });
  assert.equal(s.S.history.snapshot("second").ended, true);
});
