import assert from 'node:assert/strict';
import test from 'node:test';
import { DesktopDatabase } from '../src/main/database';
import { QuestionHistoryService } from '../src/main/question-history-service';
import { QuestionCaptureService } from '../src/main/question-capture-service';
import { BroadcastCoordinator } from '../src/main/broadcast';
import { BroadcastResultReceiver } from '../src/main/broadcast-result';
import { cancelSubmissions } from '../src/main/submission-upgrade';
import { statusForSending } from '../src/main/status';
import type { SiteStatus, SiteResult } from '../src/shared/protocol';
import type { ViewManager } from '../src/main/view-manager';
const request = (runId = 'run', text = 'Question') => ({ runId, text, sites: ['claude'] as const, tier: 'think' as const, images: [] });
function setup() {
  const db = DesktopDatabase.open(':memory:');
  const history = new QuestionHistoryService(db.questions, { deviceId: () => 'synthetic' });
  const capture = new QuestionCaptureService(history, async (_site, token) => ({ token, owned: false }));
  let status: SiteStatus = statusForSending('claude', 'run'), watched = 0;
  const manager = { markStatus: (next: SiteStatus) => { status = next; }, watchGeneration: () => { watched++; } } as unknown as ViewManager;
  const coordinator = new BroadcastCoordinator();
  return { db, history, capture, manager, coordinator, status: () => status, watched: () => watched,
    close: () => { capture.dispose(); db.close(); } };
}
test('real cancellation closes status after cancelSubmissions removes history ownership', async () => {
  const f = setup();
  let finish!: (result: SiteResult) => void;
  try {
    const prepared = await f.capture.prepareRun(request(), 44_000);
    const receive = new BroadcastResultReceiver(f.history, f.capture, f.manager).begin(prepared.dispatch, prepared.historyTokens);
    const pending = f.coordinator.send(prepared.dispatch, () => new Promise(resolve => { finish = resolve; }), prepared.remaining,
      receive);
    cancelSubmissions([f.status()], f.history, f.capture);
    f.coordinator.cancel();
    finish({ ok: true });
    assert.equal((await pending)[0].code, 'cancelled');
    assert.equal(f.status().phase, 'cancelled');
    assert.equal(f.status().submission?.state, 'cancelled');
    assert.equal(f.watched(), 0);
  } finally { f.close(); }
});
for (const sameRun of [true, false]) test(`old-history read failure cannot suppress ${sameRun ? 'same-run retry' : 'new dispatch'} or expose its old token`, async () => {
  const f = setup();
  try {
    const old = f.history.begin(request('old', 'Old text'))!;
    const oldToken = f.history.token('claude');
    f.history.result('old', { site: 'claude', ok: false, code: 'submit_unconfirmed',
      selection: { requested: 'think', observed: 'think', outcome: 'preferred', model: 'Old model' } }, oldToken);
    const before = f.db.questions.answers(old.id)[0];
    const get = f.db.questions.get.bind(f.db.questions);
    f.db.questions.get = () => { throw Error('synthetic_read_failure'); };
    const next = request(sameRun ? 'old' : 'new', sameRun ? 'Old text' : 'New text');
    const prepared = await f.capture.prepareRun(next, 44_000);
    const token = prepared.historyTokens.get('claude');
    const receive = new BroadcastResultReceiver(f.history, f.capture, f.manager).begin(prepared.dispatch, prepared.historyTokens);
    let dispatchedToken: string | undefined;
    await f.coordinator.send(prepared.dispatch, async () => { dispatchedToken = token; return { ok: true }; }, prepared.remaining,
      receive);
    assert.equal(f.status().submission?.runId, next.runId);
    assert.equal(f.status().submission?.state, 'sent');
    assert.equal(dispatchedToken, undefined);
    assert.equal(prepared.historyTokens.size, 0);
    assert.equal(f.history.token('claude'), undefined);
    f.db.questions.get = get;
    f.history.accept('claude', { token: oldToken!, owned: true, text: 'New answer', generation: 'generating' });
    assert.deepEqual(f.db.questions.answers(old.id)[0], before);
    assert.equal(f.db.questions.search().items.length, 1);
  } finally { f.close(); }
});
for (const sameRun of [true, false]) test(`real late cancelled receipt cannot replace a ${sameRun ? 'same-run retry' : 'new run'} result`, async () => {
  const f = setup();
  const receiver = new BroadcastResultReceiver(f.history, f.capture, f.manager);
  let finishOld!: (result: SiteResult) => void;
  try {
    const first = await f.capture.prepareRun(request(), 44_000);
    const old = f.coordinator.send(first.dispatch, () => new Promise(resolve => { finishOld = resolve; }), first.remaining,
      receiver.begin(first.dispatch, first.historyTokens));
    const second = await f.capture.prepareRun(request(sameRun ? 'run' : 'next', sameRun ? 'Question' : 'Next text'), 44_000);
    f.manager.markStatus(statusForSending('claude', second.dispatch.runId));
    const selection = { requested: 'think', observed: 'think', outcome: 'preferred', model: 'Current model' } as const;
    await f.coordinator.send(second.dispatch, async () => ({ ok: true, selection }), second.remaining,
      receiver.begin(second.dispatch, second.historyTokens));
    finishOld({ ok: true });
    assert.equal((await old)[0].code, 'cancelled');
    assert.equal(f.status().phase, 'submitted');
    assert.equal(f.status().submission?.runId, second.dispatch.runId);
    assert.equal(f.watched(), 1);
    const summary = f.db.questions.search().items.find(q => q.text === second.dispatch.text)!;
    const saved = f.db.questions.answers(summary.id).at(-1)!;
    assert.equal(saved.observation?.selection.outcome, 'preferred');
    assert.equal(saved.submission, 'submitted');
  } finally { f.close(); }
});
