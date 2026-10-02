"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const { source } = require("./lib/site-send-harness");

function runtime({ start = 1000, readyAt = 1000, drift = 0, expiresWhileReading = false, rollback = false } = {}) {
  let now = start;
  const clicks = [];
  class Textarea {
    get value() { return this.text; }
    set value(value) { this.text = value; }
  }
  const composer = Object.assign(new Textarea(), { tagName: "TEXTAREA", value: "CURRENT QUESTION", focus() {}, dispatchEvent() {},
    getBoundingClientRect: () => ({ width: 300, height: 40, top: 0, bottom: 40, left: 0, right: 300 }) });
  const button = {
    classList: { contains: () => now < readyAt },
    getAttribute() { if (expiresWhileReading) now = 2000; return null; },
    click: () => clicks.push({ at: now, text: composer.value })
  };
  const context = {
    window: {}, document: { querySelectorAll: selector => selector.includes("textarea") ? [composer] : [button] },
    location: { hostname: "chat.deepseek.com" }, innerWidth: 1000, innerHeight: 1000,
    HTMLTextAreaElement: Textarea, Event: class {},
    chrome: { runtime: { onMessage: { addListener() {} } } },
    Date: { now: () => now },
    setTimeout(fn, ms) {
      now += ms + drift;
      if (rollback && now > 1250) composer.value = "OLD QUESTION";
      queueMicrotask(fn);
    }
  };
  for (const file of ["core.js", "adapters-cn.js"]) vm.runInNewContext(source(file), context);
  return { submit: deadline => context.window.__AMS.adapters["deepseek.com"].submit(composer, deadline),
    send: () => context.window.__AMS.submitPrompt("CURRENT QUESTION", 2000, []), clicks };
}

for (const start of [2000, 2001]) {
  test(`DeepSeek never submits at time ${start} when its deadline is 2000`, async () => {
    const r = runtime({ start });
    await assert.rejects(r.submit(2000), /timeout/);
    assert.deepEqual(r.clicks, []);
  });
}

test("DeepSeek can submit once immediately before its deadline", async () => {
  const r = runtime({ start: 1999 });
  await r.submit(2000);
  assert.deepEqual(r.clicks, [{ at: 1999, text: "CURRENT QUESTION" }]);
});

test("a DeepSeek button becoming ready exactly at deadline cannot be clicked", async () => {
  const r = runtime({ readyAt: 2000 });
  await assert.rejects(r.submit(2000), /timeout/);
  assert.deepEqual(r.clicks, []);
});

test("a delayed polling timer cannot make DeepSeek send after deadline", async () => {
  const r = runtime({ readyAt: 2000, drift: 150 });
  await assert.rejects(r.submit(2000), /timeout/);
  assert.deepEqual(r.clicks, []);
});

test("DeepSeek rechecks deadline after reading an available button", async () => {
  const r = runtime({ expiresWhileReading: true });
  await assert.rejects(r.submit(2000), /timeout/);
  assert.deepEqual(r.clicks, []);
});

test("DeepSeek cannot submit a draft restored while its button is pending", async () => {
  const r = runtime({ readyAt: 1400, rollback: true });
  await assert.rejects(r.submit(2000), /inject_failed/);
  assert.deepEqual(r.clicks, []);
});

test("production core reports inject_failed when DeepSeek observes rollback during its own wait", async () => {
  const r = runtime({ readyAt: 1400, rollback: true });
  assert.equal((await r.send()).code, "inject_failed");
  assert.deepEqual(r.clicks, []);
});
