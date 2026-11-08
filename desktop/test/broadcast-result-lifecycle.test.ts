import assert from 'node:assert/strict';
import test from 'node:test';
import { BroadcastResultReceiver } from '../src/main/broadcast-result';
import { QuestionCaptureService } from '../src/main/question-capture-service';
import { QuestionHistoryService } from '../src/main/question-history-service';
import { DesktopDatabase } from '../src/main/database';
import type { SiteStatus } from '../src/shared/protocol';
const request = { runId: 'run', sites: ['claude'] as const, text: 'Synthetic question', tier: null, images: [] };
function setup() {
  const db = DesktopDatabase.open(':memory:');
  const history = new QuestionHistoryService(db.questions, { deviceId: () => 'local' });
  const capture = new QuestionCaptureService(history, async (_site, token) => ({ token, owned: false }));
  const statuses: SiteStatus[] = [], watched: string[] = [];
  const receiver = new BroadcastResultReceiver(history, capture, {
    markStatus: status => { statuses.push(status); }, watchGeneration: (runId, site) => { watched.push(`${runId}:${site}`); }
  });
  return { db, history, capture, receiver, statuses, watched, close: () => { capture.dispose(); db.close(); } };
}
test('local reset invalidates an actual dispatch receipt before status, watch or history can be restored', async () => {
  const f = setup();
  try {
    const prepared = await f.capture.prepareRun(request, 44_000);
    const receive = f.receiver.begin(prepared.dispatch, prepared.historyTokens);
    f.db.resetLocalData();
    receive({ site: 'claude', ok: true });
    assert.equal(f.statuses.length, 0); assert.equal(f.watched.length, 0);
    assert.equal(f.db.questions.search().items.length, 0);
  } finally { f.close(); }
});
test('receipt identity rejects replacement, unrelated sites and duplicate terminal results independently of history', () => {
  const f = setup();
  try {
    const old = f.receiver.begin(request, new Map());
    const current = f.receiver.begin(request, new Map());
    old({ site: 'claude', ok: false, code: 'cancelled' });
    old({ site: 'claude', ok: true });
    current({ site: 'chatgpt', ok: true });
    assert.equal(f.statuses.length, 0);
    current({ site: 'claude', ok: true });
    current({ site: 'claude', ok: false, code: 'cancelled' });
    assert.equal(f.statuses.length, 1); assert.equal(f.statuses[0].phase, 'submitted');
    assert.deepEqual(f.watched, ['run:claude']);
  } finally { f.close(); }
});
test('a failure writing a valid history result still publishes its independent dispatch receipt', async () => {
  const f = setup();
  try {
    const prepared = await f.capture.prepareRun(request, 44_000);
    const receive = f.receiver.begin(prepared.dispatch, prepared.historyTokens);
    f.db.questions.putAnswer = () => { throw Error('synthetic_write_failure'); };
    receive({ site: 'claude', ok: true });
    assert.equal(f.statuses[0].phase, 'submitted'); assert.equal(f.watched.length, 1);
  } finally { f.close(); }
});
test('a new run invalidates receipts for sites not included in the new request', () => {
  const f = setup();
  try {
    const old = f.receiver.begin(request, new Map());
    f.receiver.begin({ runId: 'next', sites: ['chatgpt'] }, new Map());
    old({ site: 'claude', ok: false, code: 'cancelled' });
    assert.equal(f.statuses.length, 0);
  } finally { f.close(); }
});
