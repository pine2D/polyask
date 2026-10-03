import assert from "node:assert/strict";
import test from "node:test";
import { CaptureLocateDiagnostics } from "../src/main/capture-locate-diagnostics";
import { DesktopDatabase } from "../src/main/database";
import { QuestionHistoryService } from "../src/main/question-history-service";
import { normalizeHistorySnapshot } from "../src/shared/question-capture";
import { buildSiteHealth } from "../src/shared/site-health";
import { buildSiteReport } from "../src/shared/site-report";

test("history snapshots whitelist the locate level and drop it from unowned or unknown values", () => {
  assert.equal(normalizeHistorySnapshot({ token: "t", owned: true, text: "A", locate: "anchor" }, "t").locate, "anchor");
  assert.equal("locate" in normalizeHistorySnapshot({ token: "t", owned: true, text: "A", locate: "guess" }, "t"), false);
  assert.equal("locate" in normalizeHistorySnapshot({ token: "t", owned: true, text: "A", locate: { evil: 1 } }, "t"), false);
  assert.equal("locate" in normalizeHistorySnapshot({ token: "t", owned: false, locate: "selector" }, "t"), false);
});

test("the main process counts each capture's locate level once per site", () => {
  const db = DesktopDatabase.open(":memory:");
  const counts = new CaptureLocateDiagnostics();
  try {
    let now = 1000;
    const history = new QuestionHistoryService(db.questions, { deviceId: () => "test", now: () => now,
      onLocate: (site, locate) => counts.record(site, locate) });
    history.begin({ runId: "run", sites: ["kimi", "claude"], text: "Question", tier: null, images: [] });
    history.result("run", { site: "kimi", ok: true });
    history.result("run", { site: "claude", ok: true });
    const kimi = history.token("kimi")!, claude = history.token("claude")!;
    history.accept("kimi", { token: kimi, owned: false, locate: "anchor" } as never);
    assert.deepEqual(counts.snapshot(), {}, "未归属的快照不记账");
    for (const text of ["Par", "Paris"]) { now += 1000; history.accept("kimi", { token: kimi, owned: true, text, locate: "anchor" }); }
    history.accept("claude", { token: claude, owned: true, text: "Answer", locate: "selector" });
    assert.deepEqual(counts.snapshot(), { kimi: { anchor: 1 }, claude: { selector: 1 } });
    counts.record("kimi", "made-up");
    assert.deepEqual(counts.snapshot(), { kimi: { anchor: 1 }, claude: { selector: 1 } });
  } finally { db.close(); }
});

test("a red capture probe is advisory and never marks a working site broken", () => {
  const health = buildSiteHealth({ site: "kimi", phase: "ready", navigation: "site", checks: [
    { name: "Composer", ok: true, kind: "reach" },
    { name: "Question located", ok: false, kind: "capture" },
    { name: "Answer located", ok: false, kind: "capture" }
  ] });
  assert.equal(health.state, "ready");
  assert.deepEqual(health.checks.map((check) => check.kind), ["reach", "capture", "capture"]);
});

test("the diagnostic report adds a whitelisted capture-locate line with counts only", () => {
  const report = buildSiteReport({ version: "1.0.0", distribution: "portable", platform: "Win32", scale: 1,
    sites: [{ key: "kimi", label: "Kimi" }, { key: "claude", label: "Claude" }, { key: "gemini", label: "Gemini" }],
    statuses: {}, health: {}, now: 0,
    captureLocate: { kimi: { selector: 3, anchor: 1, semantic: 0 }, claude: { selector: 2, text: "secret", semantic: -1, anchor: 1.5 } as never,
      gemini: "https://private.invalid" as never }
  });
  const lines = report.split("\n");
  assert.equal(lines[lines.indexOf("[kimi] Kimi: phase=unknown health=unknown") + 2], "  capture-locate selector=3 anchor=1");
  assert.equal(lines[lines.indexOf("[claude] Claude: phase=unknown health=unknown") + 2], "  capture-locate selector=2");
  assert.doesNotMatch(report, /secret|private|https|semantic=/);
});
