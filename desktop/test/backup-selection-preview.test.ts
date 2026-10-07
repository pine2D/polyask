import test from 'node:test';
import assert from 'node:assert/strict';
import { DesktopDatabase } from '../src/main/database';
import { BackupService } from '../src/main/backup-service';
import { questionFixture, questionAnswerFixture } from './question-fixtures';
import { questionAnswerId } from '../src/main/question-repository';

function partialAnswerDocument() {
  const source = DesktopDatabase.open(':memory:');
  try {
    source.questions.put(questionFixture());
    source.questions.putAnswer({ ...questionAnswerFixture(), capture: 'partial', sealedAt: null });
    return new BackupService(source, { deviceId: () => 'source', now: () => 200 }).export();
  } finally { source.close(); }
}

test('an unchanged interrupted-answer restore keeps its zero count as the apply clock advances', () => {
  const db = DesktopDatabase.open(':memory:');
  try {
    let clock = 200;
    const service = new BackupService(db, { deviceId: () => 'local', now: () => clock });
    const document = partialAnswerDocument();
    let preview = service.preview(document), keys = preview.items.map(item => item.key);
    assert.deepEqual(service.apply(preview.token, keys), { imported: 2, skipped: 0 });
    preview = service.preview(document); keys = preview.items.map(item => item.key);
    const count = service.previewSelection(preview.token, keys);
    assert.deepEqual(count, { imported: 0, skipped: 2, keys: [] });
    const snapshot = JSON.stringify(db.businessSnapshot()), outbox = db.outbox.count();
    clock = 201;
    assert.deepEqual(service.apply(preview.token, keys), { imported: count.imported, skipped: count.skipped });
    assert.equal(JSON.stringify(db.businessSnapshot()), snapshot, 'clock advancement does not rewrite an unchanged answer');
    assert.equal(db.outbox.count(), outbox, 'a zero-count restore enqueues no changes');
  } finally { db.close(); }
});

test('a new interrupted answer uses its token seal time while write versions use the actual apply time', () => {
  const db = DesktopDatabase.open(':memory:');
  try {
    let clock = 200;
    const service = new BackupService(db, { deviceId: () => 'local', now: () => clock });
    const preview = service.preview(partialAnswerDocument()), keys = preview.items.map(item => item.key);
    assert.deepEqual(service.previewSelection(preview.token, keys), { imported: 2, skipped: 0, keys });
    assert.equal(db.outbox.count(), 0, 'counting is read-only');
    clock = 201;
    assert.deepEqual(service.apply(preview.token, keys), { imported: 2, skipped: 0 });
    const answer = db.questions.answers('q-a')[0];
    assert.equal(answer.capture, 'interrupted');
    assert.equal(answer.sealedAt, 200, 'business sealing is stable within the reviewed token');
    assert.equal(answer.updatedAt, 201, 'sync version stamping uses the actual write time');
  } finally { db.close(); }
});

test('read-only restore counts use the selected deleted-answer subset and match the eventual transaction', () => {
  const db = DesktopDatabase.open(':memory:');
  try {
    const question = questionFixture(), a = questionAnswerFixture(), b = { ...a, attempt: 2, id: questionAnswerId(a.questionId, a.site, 2) };
    db.questions.put(question); db.questions.putAnswer(a); db.questions.putAnswer(b);
    const service = new BackupService(db, { deviceId: () => 'local', now: () => 100 });
    const document = service.export();
    for (const child of [a, b]) db.questions.putAnswer({ schema: 4, id: child.id, questionId: child.questionId, site: child.site,
      attempt: child.attempt, createdAt: child.createdAt, updatedAt: 30, deletedAt: 30, deviceId: 'local' });
    let preview = service.preview(document);
    service.apply(preview.token, preview.items.map(item => item.key));
    preview = service.preview(document);
    const selected = [`question:${question.id}`, `questionAnswer:${a.id}`];
    const snapshot = JSON.stringify(db.businessSnapshot()), outbox = db.outbox.count();
    const count = (service as any).previewSelection(preview.token, selected);
    assert.deepEqual(count, { imported: 2, skipped: 1, keys: selected });
    assert.equal(JSON.stringify(db.businessSnapshot()), snapshot, 'counting never writes business data');
    assert.equal(db.outbox.count(), outbox, 'counting never enqueues sync');
    assert.deepEqual(service.apply(preview.token, selected), { imported: count.imported, skipped: count.skipped });
    assert.ok('deletedAt' in db.questions.getAnswer(a.id)!, 'the original child tombstone survives');
  } finally { db.close(); }
});

test('selection previews reject unknown, duplicate and stale keys without consuming a valid plan', () => {
  const db = DesktopDatabase.open(':memory:');
  try {
    const service = new BackupService(db, { deviceId: () => 'local', now: () => 100 });
    const source = DesktopDatabase.open(':memory:');
    let document;
    try { source.questions.put(questionFixture()); document = new BackupService(source, { deviceId: () => 'source' }).export(); }
    finally { source.close(); }
    const preview = service.preview(document), key = preview.items[0].key;
    const count = (token: string, keys: string[]) => (service as any).previewSelection(token, keys);
    assert.throws(() => count('unknown', [key]), /backup_missing/);
    assert.throws(() => count(preview.token, [key, key]), /backup_selection/);
    assert.throws(() => count(preview.token, ['unknown']), /backup_selection/);
    assert.equal(count(preview.token, [key]).imported, 1);
    db.questions.put(questionFixture());
    assert.throws(() => count(preview.token, [key]), /backup_stale/);
    assert.throws(() => service.apply(preview.token, [key]), /backup_missing/);
  } finally { db.close(); }
});
