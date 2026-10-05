"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const { source } = require("./lib/site-send-harness");

function runtime() {
  let turn = null, mutation;
  const adapter = { historyTurn: () => turn, generation: () => "generating" };
  const S = { adapters: { "gemini.google.com": adapter }, toMarkdown: node => node.text };
  const context = {
    URL, Date: { now: () => 1000 }, setTimeout: () => 1, clearTimeout() {},
    document: { documentElement: {}, addEventListener() {}, removeEventListener() {} },
    window: { __AMS: S, addEventListener() {}, removeEventListener() {} },
    location: { hostname: "gemini.google.com", href: "https://gemini.google.com/app" },
    MutationObserver: class { constructor(fn) { mutation = fn; } observe() {} disconnect() {} }
  };
  for (const file of ["history-route.js", "history.js"]) vm.runInNewContext(source(file), context);
  S.history.begin("current", "Question");
  return {
    history: S.history, turn: value => { turn = value; },
    insert: nodes => mutation([{ addedNodes: nodes }]),
    navigate: (href = "https://gemini.google.com/app/other") => { context.location.href = href; }
  };
}
const user = () => ({ isConnected: true });
const matching = node => ({ user: node, text: "Question", userCount: 1, answer: { text: "Final answer", isConnected: true } });

for (const batch of [false, true]) {
  test(`first user insertion survives 501 unrelated nodes in ${batch ? "one batch" : "separate batches"}`, () => {
    const r = runtime(), noise = Array.from({ length: 501 }, () => ({ isConnected: false }));
    if (batch) r.insert(noise);
    else for (const node of noise) r.insert([node]);
    const current = user(); r.turn(matching(current)); r.insert([current]);
    const result = r.history.snapshot("current");
    assert.equal(result.owned, true);
    assert.equal(result.text, "Final answer");
    assert.equal(r.history.submitted("current"), true);
  });
}

test("late selector hydration still binds a previously inserted user after unrelated churn", () => {
  const r = runtime();
  for (let i = 0; i < 501; i++) r.insert([{}]);
  const current = user(); r.insert([current]);
  r.turn(matching(current));
  assert.equal(r.history.snapshot("current").text, "Final answer");
});

test("an inserted subtree is positive evidence for its current user descendant", () => {
  const r = runtime(), current = user();
  const parent = { contains: node => node === current };
  current.parentNode = parent;
  for (let i = 0; i < 501; i++) r.insert([{}]);
  r.turn(matching(current)); r.insert([parent]);
  assert.equal(r.history.snapshot("current").text, "Final answer");
});

test("unrelated insertion churn cannot claim an old same-text user already on the page", () => {
  const r = runtime();
  for (let i = 0; i < 501; i++) r.insert([{}]);
  r.turn(matching(user()));
  assert.equal(r.history.snapshot("current").owned, false);
  assert.equal(r.history.submitted("current"), false);
});

test("first-turn insertion evidence cannot claim a user after an owned route changes", () => {
  const r = runtime(), current = user();
  r.navigate("https://gemini.google.com/app/first");
  r.turn(matching(current)); r.insert([current]);
  assert.equal(r.history.snapshot("current").text, "Final answer");
  r.navigate();
  assert.equal(r.history.snapshot("current").owned, false);
});
