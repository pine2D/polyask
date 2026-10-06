import assert from "node:assert/strict";
import test from "node:test";
import { DesktopDatabase } from "../src/main/database";
import { GenerationMonitor } from "../src/main/generation-monitor";
import { QuestionHistoryService, SEAL_QUIET_MS } from "../src/main/question-history-service";
import { normalizeHistorySnapshot } from "../src/shared/question-capture";
import { buildSiteReport } from "../src/shared/site-report";

const request = { runId: "run", sites: ["claude"] as const, text: "Question", tier: null, images: [] };
test("revoked completion rearms exactly the current attempt and can be confirmed again", () => {
  const db = DesktopDatabase.open(":memory:");
  let now = 1000, reopens = 0;
  const history = new QuestionHistoryService(db.questions, {deviceId: () => "local", now: () => ++now});
  const monitor = new GenerationMonitor();
  try {
    const q = history.begin(request)!; const token = history.token("claude")!;
    history.result("run", {site:"claude", ok:true}); monitor.begin("run", ["claude"]);
    history.setGenerationResumeHandler((run, site) => { reopens++; assert.equal(monitor.reopen(run, site), true); });
    monitor.onComplete = (run, site) => { history.complete(run, site); };
    monitor.accept("run", "claude", "generating");
    for(let i=0;i<3;i++) monitor.accept("run", "claude", "complete");
    const oldTicket = monitor.ticket("run", "claude")!;
    history.accept("claude", {token,owned:true,text:"Growing",generation:"generating"}, history.readMark());
    assert.equal(reopens, 1); assert.equal(monitor.holds(oldTicket, "claude"), false);
    history.accept("claude", {token,owned:true,text:"Still growing",generation:"generating"}, history.readMark());
    assert.equal(reopens, 1);
    for(let i=0;i<3;i++) monitor.accept("run", "claude", "complete");
    history.accept("claude", {token,owned:true,text:"Final",generation:null}, history.readMark());
    now += SEAL_QUIET_MS + 1;
    history.accept("claude", {token,owned:true,text:"Final",generation:null}, history.readMark());
    assert.equal(db.questions.answers(q.id)[0].capture, "complete");
    history.accept("claude", {token,owned:true,text:"Too late",generation:"generating"}, history.readMark());
    assert.equal(reopens, 1);
    assert.equal(monitor.reopen("different-run", "claude"), false);
  } finally { db.close(); }
});

test("capture reason normalization and report use enums, rejecting private arbitrary strings", () => {
  const v = normalizeHistorySnapshot({token:"token",owned:false,captureCode:"turn_unconfirmed"}, "token");
  assert.equal(v.captureCode, "turn_unconfirmed");
  const bad = normalizeHistorySnapshot({token:"token",owned:false,captureCode:"https://private.invalid/chat"}, "token");
  assert.equal(bad.captureCode, undefined);
  const report = buildSiteReport({version:"test",distribution:"dev",platform:"linux",scale:1, now:0,
    sites:[{key:"claude",label:"Claude"}], statuses:{},health:{},
    captureLocate:{claude:{reasons:{turn_unconfirmed:2, route_changed:1, "private-text":5}}} as never});
  assert.match(report, /capture-reason turn_unconfirmed=2/);
  assert.doesNotMatch(report, /private-text/);
});
