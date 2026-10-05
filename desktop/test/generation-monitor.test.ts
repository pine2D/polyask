import assert from "node:assert/strict";
import test from "node:test";

import { GenerationMonitor } from "../src/main/generation-monitor";
import type { SiteKey } from "../src/shared/contracts";

function reachComplete(monitor: GenerationMonitor, runId: string, site: SiteKey): void {
  monitor.accept(runId, site, "generating");
  monitor.accept(runId, site, "complete");
  monitor.accept(runId, site, "complete");
  monitor.accept(runId, site, "complete");
}

test("completion is accepted only after the same run observed generation", () => {
  const monitor = new GenerationMonitor();
  monitor.begin("run-1", ["claude"]);
  assert.equal(monitor.accept("run-1", "claude", "complete"), "submitted");
  assert.equal(monitor.accept("run-1", "claude", "generating"), "generating");
  reachComplete(monitor, "run-1", "claude");
  assert.equal(monitor.accept("run-1", "claude", "complete"), "complete");
  monitor.begin("run-2", ["claude"]);
  assert.equal(monitor.accept("run-1", "claude", "complete"), null);
});

test("unsupported probes stay submitted and completed sites stay terminal", () => {
  const monitor = new GenerationMonitor();
  monitor.begin("run-1", ["claude", "gemini"]);
  assert.equal(monitor.accept("run-1", "claude", null), "submitted");
  assert.equal(monitor.accept("run-1", "gemini", "idle"), "submitted");
  assert.equal(monitor.accept("run-1", "claude", "generating"), "generating");
  reachComplete(monitor, "run-1", "claude");
  assert.equal(monitor.accept("run-1", "claude", "generating"), "complete");
  assert.equal(monitor.accept("run-1", "chatgpt", "generating"), null);
});

test("a single complete reading never settles the terminal phase", () => {
  const monitor = new GenerationMonitor();
  monitor.begin("run-1", ["claude"]);
  assert.equal(monitor.accept("run-1", "claude", "generating"), "generating");
  assert.equal(monitor.accept("run-1", "claude", "complete"), "generating");
  assert.equal(monitor.accept("run-1", "claude", "complete"), "generating");
  assert.equal(monitor.accept("run-1", "claude", "complete"), "complete");
});

test("resumed generation between complete readings restarts the debounce", () => {
  const monitor = new GenerationMonitor();
  monitor.begin("run-1", ["claude"]);
  monitor.accept("run-1", "claude", "generating");
  monitor.accept("run-1", "claude", "complete");
  monitor.accept("run-1", "claude", "complete");
  assert.equal(monitor.accept("run-1", "claude", "generating"), "generating");
  assert.equal(monitor.accept("run-1", "claude", "complete"), "generating");
  assert.equal(monitor.accept("run-1", "claude", "complete"), "generating");
  assert.equal(monitor.accept("run-1", "claude", "complete"), "complete");
});

test("probes that read nothing neither confirm nor reset the debounce", () => {
  const monitor = new GenerationMonitor();
  monitor.begin("run-1", ["claude"]);
  monitor.accept("run-1", "claude", "generating");
  assert.equal(monitor.accept("run-1", "claude", "complete"), "generating");
  assert.equal(monitor.accept("run-1", "claude", null), "generating");
  assert.equal(monitor.accept("run-1", "claude", "complete"), "generating");
  assert.equal(monitor.accept("run-1", "claude", "complete"), "complete");
});

test("retrying the same run keeps every existing site entry", () => {
  const monitor = new GenerationMonitor();
  assert.equal(monitor.begin("run-1", ["claude", "gemini"]), false);
  monitor.accept("run-1", "claude", "generating");
  assert.equal(monitor.begin("run-1", ["gemini"]), true);
  assert.equal(monitor.accept("run-1", "claude", "generating"), "generating");
  assert.equal(monitor.accepts("run-1", "claude"), true);
  assert.equal(monitor.accepts("run-1", "gemini"), true);
});

test("a resumed run rearms the sites it retries and keeps the others", () => {
  // Windows R7a: a same-runId retry of an already-complete site showed "complete" 1.2s after
  // resubmitting, because the first attempt's entry was kept.
  const monitor = new GenerationMonitor();
  monitor.begin("run-1", ["claude", "gemini", "kimi"]);
  reachComplete(monitor, "run-1", "claude");
  reachComplete(monitor, "run-1", "kimi");
  monitor.accept("run-1", "gemini", "generating");
  assert.equal(monitor.begin("run-1", ["claude", "doubao"]), true);
  assert.equal(monitor.accept("run-1", "claude", "idle"), "submitted", "the retried site starts over");
  assert.equal(monitor.accept("run-1", "claude", "complete"), "submitted", "old generating evidence does not carry over");
  assert.equal(monitor.accept("run-1", "doubao", "idle"), "submitted");
  assert.equal(monitor.accept("run-1", "kimi", "idle"), "complete", "a site not retried keeps its settled phase");
  assert.equal(monitor.accept("run-1", "gemini", "complete"), "generating", "a site still streaming keeps its evidence");
  monitor.accept("run-1", "claude", "generating");
  reachComplete(monitor, "run-1", "claude");
  assert.equal(monitor.accept("run-1", "claude", "idle"), "complete", "the retry settles on its own evidence");
});

test("invalidating a run rejects every late probe", () => {
  const monitor = new GenerationMonitor();
  monitor.begin("run-1", ["claude"]);
  monitor.invalidate();
  assert.equal(monitor.accept("run-1", "claude", "generating"), null);
});

test("a cancelled run cannot be resumed and restarts from the retried sites", () => {
  const monitor = new GenerationMonitor();
  monitor.begin("run-1", ["claude", "gemini"]);
  monitor.invalidate();
  assert.equal(monitor.begin("run-1", ["gemini"]), false);
  assert.equal(monitor.accepts("run-1", "gemini"), true);
  assert.equal(monitor.accepts("run-1", "claude"), false);
});

test("forgetting one site leaves the rest of the run watched", () => {
  const monitor = new GenerationMonitor();
  monitor.begin("run-1", ["claude", "gemini"]);
  monitor.forget("claude");
  assert.equal(monitor.accepts("run-1", "claude"), false);
  assert.equal(monitor.accept("run-1", "claude", "generating"), null);
  assert.equal(monitor.accepts("run-1", "gemini"), true);
});

test("starting another site's run preserves the first site's completion watch", () => {
  const monitor = new GenerationMonitor();
  monitor.begin("first", ["claude"]);
  monitor.accept("first", "claude", "generating");
  monitor.begin("second", ["gemini"]);
  assert.equal(monitor.accepts("first", "claude"), true);
  reachComplete(monitor, "first", "claude");
  assert.equal(monitor.accept("first", "claude", "complete"), "complete");
  assert.equal(monitor.accepts("second", "gemini"), true);
  monitor.begin("third", ["claude"]);
  assert.equal(monitor.accepts("first", "claude"), false);
  assert.equal(monitor.accepts("second", "gemini"), true);
  monitor.invalidate();
  assert.equal(monitor.accepts("second", "gemini"), false);
});

test("assisted monitoring does not replace the latest broadcast retry identity", () => {
  const monitor = new GenerationMonitor();
  monitor.begin("broadcast", ["claude", "gemini"]);
  monitor.begin("assisted", ["kimi"], false);
  assert.equal(monitor.begin("broadcast", ["gemini"]), true);
  assert.equal(monitor.accepts("broadcast", "claude"), true);
  assert.equal(monitor.accepts("assisted", "kimi"), true);
});

test("cancelling a dispatch subset preserves already submitted older watches", () => {
  const monitor = new GenerationMonitor();
  monitor.begin("old", ["claude"]);
  monitor.accept("old", "claude", "generating");
  monitor.begin("new", ["gemini"]);
  monitor.invalidate(["gemini"]);
  assert.equal(monitor.accepts("old", "claude"), true);
  assert.equal(monitor.accepts("new", "gemini"), false);
  assert.equal(monitor.begin("new", ["gemini"]), false);
  reachComplete(monitor, "old", "claude");
  assert.equal(monitor.accept("old", "claude", "complete"), "complete");
});

test("a latched stop-control observation settles a short answer the probes never saw generating", () => {
  const monitor = new GenerationMonitor();
  monitor.begin("run-1", ["claude"]);
  assert.equal(monitor.accept("run-1", "claude", "complete"), "submitted", "无证据的 complete 仍不收口");
  assert.equal(monitor.accept("run-1", "claude", "complete_observed"), "submitted");
  assert.equal(monitor.accept("run-1", "claude", "complete_observed"), "submitted");
  assert.equal(monitor.accept("run-1", "claude", "complete_observed"), "complete", "仍要连续三次确认");
  monitor.begin("run-2", ["claude"]);
  assert.equal(monitor.accept("run-2", "claude", "complete_observed"), "submitted");
  assert.equal(monitor.accept("run-2", "claude", "idle"), "submitted", "idle 照旧清零连击");
  assert.equal(monitor.accept("run-2", "claude", "complete"), "submitted");
  assert.equal(monitor.accept("run-2", "claude", "complete"), "submitted");
  assert.equal(monitor.accept("run-2", "claude", "complete"), "complete", "锁存见证过生成后，普通 complete 也可收口");
});
