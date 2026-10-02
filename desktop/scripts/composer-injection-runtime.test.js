"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const { source } = require("./lib/site-send-harness");

// Execute production injection and submission; only the external editor's
// controlled updates and DOM surface are simulated.
function runtime({ kind = "textarea", rollback, initial = "OLD QUESTION", render = text => text } = {}) {
  let now = 1000, text = initial, rendered = initial, injected = false;
  const submitted = [];
  class Event { constructor(type, init) { this.type = type; Object.assign(this, init); } }
  class Textarea {
    get value() { return text; }
    set value(value) { text = value; }
  }
  const composer = kind === "textarea" ? new Textarea() : {};
  Object.assign(composer, {
    tagName: kind === "textarea" ? "TEXTAREA" : "DIV", focus() {},
    getBoundingClientRect: () => ({ left: 0, right: 400, top: 100, bottom: 140, width: 400, height: 40 }),
    dispatchEvent(event) {
      if (event.type === "input") {
        injected = true;
        if (rollback === "sync") text = initial;
      }
    }
  });
  if (kind !== "textarea") Object.defineProperties(composer, {
    textContent: { get: () => text, set: value => { text = value; } },
    innerText: { get: () => rendered }
  });
  const context = {
    window: {}, document: { querySelectorAll: () => [composer] },
    location: { hostname: "fixture.invalid" }, innerWidth: 1000, innerHeight: 1000,
    HTMLTextAreaElement: Textarea, Event, InputEvent: Event, KeyboardEvent: Event,
    chrome: { runtime: { onMessage: { addListener() {} } } },
    Date: { now: () => now }, clearTimeout() {},
    setTimeout(fn, ms) {
      now += ms;
      if (injected && rollback === "async") { text = initial; rendered = initial; }
      queueMicrotask(fn);
    }
  };
  vm.runInNewContext(source("core.js"), context);
  const S = context.window.__AMS;
  if (kind !== "textarea") S.adapters["fixture.invalid"] = {
    inject(_el, value) {
      text = value.replace(/\n/g, ""); rendered = render(value); injected = true;
      if (rollback === "sync") rendered = initial;
      return true;
    }
  };
  S.sendBtn = () => ({ disabled: false, click() { submitted.push(kind === "textarea" ? text : rendered); text = ""; rendered = ""; injected = false; } });
  return { submit: value => S.submitPrompt(value, 10000, []), submitted };
}

for (const rollback of ["sync", "async"]) {
  test(`nonempty textarea ${rollback} rollback rejects the old draft before submission`, async () => {
    const r = runtime({ rollback });
    const result = await r.submit("NEW QUESTION");
    assert.equal(result.code, "inject_failed");
    assert.equal(result.ok, false);
    assert.deepEqual(r.submitted, []);
  });
}

test("textarea partial injection cannot submit a nonempty prefix", async () => {
  const r = runtime({ rollback: "sync", initial: "NEW" });
  assert.equal((await r.submit("NEW QUESTION")).code, "inject_failed");
  assert.deepEqual(r.submitted, []);
});

test("textarea multiline content submits exactly once without losing word spacing", async () => {
  const r = runtime();
  assert.equal((await r.submit("First  line\nSecond line")).ok, true);
  assert.deepEqual(r.submitted, ["First  line\nSecond line"]);
});

test("contenteditable uses rendered line breaks rather than concatenated textContent", async () => {
  const r = runtime({ kind: "editable", render: () => "First line\r\nSecond line" });
  assert.equal((await r.submit("First line\nSecond line")).ok, true);
  assert.deepEqual(r.submitted, ["First line\r\nSecond line"]);
});

test("contenteditable changed word spacing is rejected instead of normalized away", async () => {
  const r = runtime({ kind: "editable", render: () => "First line" });
  assert.equal((await r.submit("First  line")).code, "inject_failed");
  assert.deepEqual(r.submitted, []);
});

for (const rollback of ["sync", "async"]) {
  test(`contenteditable ${rollback} rollback cannot submit the old draft`, async () => {
    const r = runtime({ kind: "editable", rollback });
    assert.equal((await r.submit("NEW QUESTION")).code, "inject_failed");
    assert.deepEqual(r.submitted, []);
  });
}
