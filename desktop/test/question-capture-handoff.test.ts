import assert from "node:assert/strict";
import test from "node:test";
import { DesktopDatabase } from "../src/main/database";
import { QuestionHistoryService, SEAL_QUIET_MS } from "../src/main/question-history-service";
import { QuestionCaptureService } from "../src/main/question-capture-service";
import { BroadcastCoordinator } from "../src/main/broadcast";
import { cancelSubmissions } from "../src/main/submission-upgrade";
const request = (runId: string) => ({runId,sites:["claude"] as const,text:runId,tier:null,images:[]});
const drain = async () => { for(let i=0;i<8;i++) await new Promise(resolve => setImmediate(resolve)); };

test("a quick follow-up waits for a confirmed first answer's final re-read before replacing its token", async t => {
  t.mock.timers.enable({apis:["Date","setTimeout"],now:1000});
  const db = DesktopDatabase.open(":memory:");
  const history = new QuestionHistoryService(db.questions,{deviceId:()=>"local"});
  const q = history.begin(request("first"))!; history.result("first",{site:"claude",ok:true});
  const token = history.token("claude")!;
  const capture = new QuestionCaptureService(history, async (_site,currentToken) => ({token:currentToken,owned:true,text:"First final answer",generation:null}));
  try {
    history.complete("first","claude");
    await capture.tick();
    const preparing = capture.prepareRun(request("follow-up"),44_000);
    await drain();
    assert.equal(history.token("claude"), token, "do not interrupt a seal candidate just to open the follow-up");
    t.mock.timers.tick(SEAL_QUIET_MS + 100);
    await preparing;
    assert.equal(db.questions.answers(q.id)[0].capture,"complete");
    assert.equal(db.questions.answers(q.id)[0].answerMarkdown,"First final answer");
    assert.notEqual(history.token("claude"), token);
  } finally {capture.dispose();db.close();}
});

test("an unconfirmed quiet answer neither delays a follow-up nor becomes complete", async () => {
  const db = DesktopDatabase.open(":memory:");
  const history = new QuestionHistoryService(db.questions,{deviceId:()=>"local"});
  const q = history.begin(request("first"))!; history.result("first",{site:"claude",ok:true});
  const capture = new QuestionCaptureService(history, async (_site,token) => ({token,owned:true,text:"Unconfirmed text",generation:null}));
  try {
    await capture.prepareRun(request("follow-up"),44_000);
    assert.equal(db.questions.answers(q.id)[0].capture,"interrupted");
    assert.equal(db.questions.answers(q.id)[0].captureCode,"superseded");
  } finally {capture.dispose();db.close();}
});

test("reset or disposal during the quiet-window wait cancels the deferred follow-up", async t => {
  t.mock.timers.enable({apis:["Date","setTimeout"],now:1000});
  const db = DesktopDatabase.open(":memory:");
  const history = new QuestionHistoryService(db.questions,{deviceId:()=>"local"});
  history.begin(request("first")); history.result("first",{site:"claude",ok:true});
  const capture = new QuestionCaptureService(history, async (_site,token) => ({token,owned:true,text:"Final",generation:null}));
  try {
    history.complete("first","claude"); await capture.tick();
    const preparing = capture.prepareRun(request("follow-up"),44_000);
    const rejected = assert.rejects(preparing,/cancelled/);
    await drain(); capture.dispose(); t.mock.timers.tick(SEAL_QUIET_MS + 100);
    await rejected;
    assert.equal(db.questions.search().items.length,1);
  } finally {capture.dispose();db.close();}
});

test("a handoff cannot extend an almost exhausted send budget", async t => {
  t.mock.timers.enable({apis:["Date","setTimeout"],now:1000});
  const db = DesktopDatabase.open(":memory:");
  const history = new QuestionHistoryService(db.questions,{deviceId:()=>"local"});
  const q = history.begin(request("first"))!; history.result("first",{site:"claude",ok:true});
  const capture = new QuestionCaptureService(history, async (_site,token) => ({token,owned:true,text:"Final",generation:null}));
  try {
    history.complete("first","claude"); await capture.tick();
    const prepared = await capture.prepareRun(request("follow-up"),1000);
    assert.ok(prepared.remaining <= 1000);
    assert.equal(db.questions.answers(q.id)[0].capture,"interrupted");
  } finally {capture.dispose();db.close();}
});

test("shell cancellation during preparation prevents dispatch and keeps the previous capture alive", async t => {
  t.mock.timers.enable({apis:["Date","setTimeout"],now:1000});
  const db = DesktopDatabase.open(":memory:");
  const history = new QuestionHistoryService(db.questions,{deviceId:()=>"local"});
  const q = history.begin(request("first"))!; history.result("first",{site:"claude",ok:true});
  const coordinator = new BroadcastCoordinator();
  const capture = new QuestionCaptureService(history, async (_site,token) => ({token,owned:true,text:"Final",generation:null}));
  let dispatches = 0;
  try {
    history.complete("first","claude"); await capture.tick();
    const sending = capture.prepareRun(request("follow-up"),44_000).then(prepared =>
      coordinator.send(prepared.dispatch, async () => { dispatches++; return {ok:true}; }, prepared.remaining));
    const rejected = assert.rejects(sending,/cancelled/);
    await drain();
    cancelSubmissions([{site:"claude",phase:"complete"}],history,capture); coordinator.cancel();
    t.mock.timers.tick(SEAL_QUIET_MS + 100); await rejected;
    assert.equal(dispatches,0);
    await capture.tick();
    assert.equal(db.questions.search().items.length,1);
    assert.equal(db.questions.answers(q.id)[0].capture,"complete");
    assert.equal(db.questions.answers(q.id)[0].answerMarkdown,"Final");
    const next = await capture.prepareRun(request("after-cancel"),44_000);
    assert.deepEqual(next.dispatch.sites,["claude"],"a later explicit send still works");
  } finally {capture.dispose();db.close();}
});
