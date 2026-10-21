import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { DesktopDatabase } from '../src/main/database';
import { QuestionCaptureService } from '../src/main/question-capture-service';
import { QuestionHistoryService } from '../src/main/question-history-service';
import { MAX_IMAGE_BYTES } from '../src/shared/images';
import type { BroadcastRequest } from '../src/shared/protocol';
import { image } from './lib/question-attachment-fixtures';
const request = (runId = 'run-a'): BroadcastRequest => ({ runId, text: '原图提问', sites: ['claude'], tier: null, images: [image()] });

function fixture(action: (db: DesktopDatabase, raw: DatabaseSync) => void) {
  const dir = mkdtempSync(join(tmpdir(), 'polyask-attachment-capture-'));
  const path = join(dir, 'data.sqlite'); const db = DesktopDatabase.open(path); const raw = new DatabaseSync(path);
  try { action(db, raw); } finally { raw.close(); db.close(); rmSync(dir, { recursive: true, force: true }); }
}

test('history captures originals once per run, retry shares set and new run gets a new set', () => fixture(db => {
  let saves = 0; const realSave = db.questionAttachments.save.bind(db.questionAttachments);
  db.questionAttachments.save = (q, originals) => { saves++; realSave(q, originals); };
  let id = 0; const history = new QuestionHistoryService(db.questions, { deviceId: () => 'a', now: () => 10, createId: () => `q-${++id}` });
  const first = history.begin(request())!; const initial = db.questionAttachments.forQuestion(first.id)!;
  assert.deepEqual(db.questionAttachments.readAll(first.id), request().images);
  const revision = db.outbox.ready(100).find(op => op.kind === 'questionAttachments')!.revision;
  assert.equal(history.begin(request())?.id, first.id); assert.equal(db.questions.answers(first.id).length, 2);
  assert.equal(saves, 1, 'same-run retry must share the existing set without saving originals again');
  assert.equal(db.questionAttachments.forQuestion(first.id)?.id, initial.id);
  assert.equal(db.outbox.ready(100).find(op => op.kind === 'questionAttachments')!.revision, revision);
  const second = history.begin(request('run-b'))!;
  assert.equal(first.id !== second.id, true); assert.equal(db.questionAttachments.all().length, 2);
}));

test('failed BLOB transaction preserves committed question, attempts, capture token and dispatch lifecycle', () => fixture((db, raw) => {
  let textFailures = 0, attachmentFailures = 0, handlerFailures = 0;
  const history = new QuestionHistoryService(db.questions, { deviceId: () => 'a', now: () => 10, createId: () => 'q-a',
    onFailure: () => textFailures++, onAttachmentSaveFailure: () => attachmentFailures++ });
  history.setAttachmentSaveFailureHandler(() => { handlerFailures++; throw new Error('UI failure'); });
  raw.exec("CREATE TRIGGER deny_blob BEFORE INSERT ON question_attachment_items BEGIN SELECT RAISE(ABORT, 'disk full'); END");
  const q = history.begin(request())!;
  assert.equal(q?.id, 'q-a'); assert.equal(db.questions.get(q.id)?.id, q.id);
  assert.equal(db.questions.answers(q.id).length, 1); assert.equal(typeof history.token('claude'), 'string');
  assert.equal(db.questionAttachments.forQuestion(q.id), null);
  assert.equal(db.outbox.ready(100).filter(op => op.kind === 'questionAttachments').length, 0);
  assert.equal(attachmentFailures, 1); assert.equal(handlerFailures, 1); assert.equal(textFailures, 0);
  assert.equal(history.getRunProgress('run-a')?.state, 'available');
  history.result('run-a', { site: 'claude', ok: true });
  assert.equal(db.questions.answers(q.id)[0].submission, 'submitted');
  raw.exec('DROP TRIGGER deny_blob');
  history.begin({ ...request(), images: [image('different.png')] });
  assert.equal(db.questionAttachments.forQuestion(q.id), null, 'changed retry must never backfill a missing original');
  history.begin(request());
  assert.deepEqual(db.questionAttachments.readAll(q.id), request().images);
  assert.equal(textFailures, 0); assert.equal(attachmentFailures, 2);
}));

test('same run cannot replace originals and deletion/reset cannot revive a capture', () => fixture(db => {
  let failures = 0; const history = new QuestionHistoryService(db.questions, { deviceId: () => 'a', createId: () => 'q-a', onAttachmentSaveFailure: () => failures++ });
  const q = history.begin(request())!;
  history.begin({ ...request(), images: [image('different.png')] });
  assert.deepEqual(db.questionAttachments.readAll(q.id), request().images); assert.equal(failures, 1);
  history.delete(q.id); assert.equal(history.begin(request()), null);
  db.resetLocalData(); assert.equal(history.begin(request()), null); assert.equal(db.questionAttachments.all().length, 0);
}));

test('a synthesized 10 MiB batch saves within the original send preparation budget', async t => {
  const db = DesktopDatabase.open(':memory:');
  const history = new QuestionHistoryService(db.questions, { deviceId: () => 'a' });
  const capture = new QuestionCaptureService(history, async () => ({ token: '', owned: false }));
  try {
    const images = Array.from({ length: 4 }, (_, i) => image(`${i}.png`, 'image/png', MAX_IMAGE_BYTES / 4));
    const start = performance.now(); const { remaining } = await capture.prepareRun({ ...request(), images }, 90_000);
    const elapsed = performance.now() - start;
    const q = db.questions.search().items[0];
    assert.equal(db.questionAttachments.readAll(q.id).reduce((n, img) => n + img.size, 0), MAX_IMAGE_BYTES);
    assert.equal(remaining > 0 && remaining <= 90_000 - Math.floor(elapsed) + 2, true);
    t.diagnostic(`10 MiB preparation/save: ${elapsed.toFixed(2)} ms; original 90000 ms deadline remaining: ${remaining} ms`);
  } finally { capture.dispose(); db.close(); }
});

test('an injected save delay consumes the original absolute send deadline without resetting it', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: 1000 });
  const db = DesktopDatabase.open(':memory:');
  const history = new QuestionHistoryService(db.questions, { deviceId: () => 'a' });
  const capture = new QuestionCaptureService(history, async () => ({ token: '', owned: false }));
  const realSave = db.questionAttachments.save.bind(db.questionAttachments);
  db.questionAttachments.save = (question, originals) => { t.mock.timers.tick(2000); realSave(question, originals); };
  try {
    const original = request(); const prepared = await capture.prepareRun(original, 90_000);
    assert.equal(prepared.remaining, 88_000); assert.equal(prepared.dispatch === original, true);
    assert.equal(db.questions.answers(history.getRunProgress(original.runId)!.questionId!)[0].submission, 'pending');
    t.diagnostic('Injected 2000 ms save delay; original deadline 91000, now 3000, remaining 88000 ms');
  } finally { capture.dispose(); db.close(); }
});
