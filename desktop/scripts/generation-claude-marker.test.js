const assert = require("node:assert/strict");
const test = require("node:test");
const { replayHtml } = require("./lib/dom-replay");
const pause = r => new Promise(resolve => r.window.setTimeout(resolve, 0));

test("Claude's new streaming root supplies positive evidence when Stop is absent", async () => {
  const r = replayHtml("", {host:"claude.ai",path:"/chat/one"});
  try {
    r.S.armGeneration();
    r.document.body.insertAdjacentHTML("beforeend", '<div data-testid="assistant-message" data-turn-key="new" data-is-streaming="true"><div data-perf-reply-text>O</div></div>');
    await pause(r);
    assert.equal(r.adapter.generation(), "generating");
    r.document.querySelector('[data-testid="assistant-message"]').setAttribute("data-is-streaming", "false");
    r.document.querySelector('[data-perf-reply-text]').textContent = "OK";
    await pause(r);
    assert.equal(r.S.generationProbe(), "complete_observed");
  } finally {r.close();}
});

test("a remounted old Claude streaming key cannot provide positive evidence", async () => {
  const html = '<div data-turn-key="old"><div data-testid="assistant-message" data-is-streaming="true"><div data-perf-reply-text>Old</div></div></div>';
  const r = replayHtml(html, {host:"claude.ai",path:"/chat/one"});
  try {
    r.S.armGeneration();
    r.document.body.innerHTML = html; await pause(r);
    assert.notEqual(r.S.generationProbe(), "generating");
    r.document.querySelector('[data-testid="assistant-message"]').setAttribute("data-is-streaming", "false"); await pause(r);
    assert.equal(r.S.generationProbe(), "complete", "same message key is still the prior turn");
  } finally {r.close();}
});

test("an old streaming root and an unobserved false marker cannot confirm a new answer", async () => {
  const r = replayHtml('<div data-testid="assistant-message" data-turn-key="old" data-is-streaming="true"><div data-perf-reply-text>Old</div></div>', {host:"claude.ai",path:"/chat/one"});
  try {
    r.S.armGeneration();
    assert.notEqual(r.S.generationProbe(), "generating", "the previous turn's true marker cannot arm the new run");
    r.document.body.append(r.document.createElement("span")); await pause(r);
    r.document.querySelector('[data-testid="assistant-message"]').setAttribute("data-is-streaming", "false"); await pause(r);
    assert.equal(r.S.generationProbe(), "complete");
    r.document.body.insertAdjacentHTML("beforeend", '<div data-testid="assistant-message" data-turn-key="new" data-is-streaming="false"><div data-perf-reply-text>Unobserved</div></div>');
    await pause(r);
    assert.equal(r.S.generationProbe(), "complete", "false alone does not prove this turn generated");
  } finally {r.close();}
});
