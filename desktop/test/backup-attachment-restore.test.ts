import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm, readdir, writeFile } from 'node:fs/promises';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { DesktopDatabase } from '../src/main/database';
import { BackupService } from '../src/main/backup-service';
import { questionAttachmentId } from '../src/main/question-attachment-repository';
import { image, question } from './lib/question-attachment-fixtures';

async function fixture(run: (db: DesktopDatabase, service: BackupService, path: string, dir: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), 'polyask-restore-images-'));
  const db = DesktopDatabase.open(':memory:');
  const service = new BackupService(db, { deviceId: () => 'local', stagingRoot: dir });
  try {
    const q = question(); db.questions.put(q); db.questionAttachments.save(q, [image()]);
    const path = join(dir, 'valid.polyask'); await service.exportFile(path);
    await run(db, service, path, dir);
  } finally { service.dispose(); db.close(); await rm(dir, { recursive: true, force: true }); }
}
const questions = (db: DesktopDatabase) => db.businessSnapshot().filter(row => row.table === 'questions').map(row => row.body as { id: string });
const all = (p: { items: readonly { key: string }[] }) => p.items.map(item => item.key);
const stages = async (dir: string) => (await readdir(dir)).filter(name => name.startsWith('polyask-backup-stage-')).length;

test('deleted parent restore remaps original set with a stable identity and never revives a deleted restored copy', () => fixture(async (db, service, path) => {
  const original = db.questions.get('q-a')!;
  db.questions.put({ schema: 4, id: original.id, createdAt: 10, updatedAt: 20, deletedAt: 20, deviceId: 'local' });
  let p = await service.previewFile(path);
  const attachment = p.items.find(item => item.kind === 'questionAttachments')!;
  assert.deepEqual(attachment.requires, ['question:q-a']);
  assert.equal(service.apply(p.token, [attachment.key]).imported, 0, 'attachments cannot implicitly restore a parent');
  p = await service.previewFile(path);
  assert.equal(service.apply(p.token, ['question:q-a']).imported, 1);
  const mapped = questions(db).find(q => q.id !== 'q-a')!;
  assert.equal('deletedAt' in mapped, false);
  p = await service.previewFile(path);
  assert.equal(service.apply(p.token, all(p)).imported, 1, 'later selection of originals uses the same restored parent');
  assert.deepEqual(db.questionAttachments.readAll(mapped.id), [image()]);
  assert.equal(db.questionAttachments.forQuestion(mapped.id)?.id, questionAttachmentId(mapped.id));
  p = await service.previewFile(path); assert.equal(service.apply(p.token, all(p)).imported, 0);
  db.questionAttachments.deleteForQuestion(mapped.id, Date.now() + 10, 'local');
  p = await service.previewFile(path); assert.equal(service.apply(p.token, all(p)).imported, 0);
  assert.equal(questions(db).length, 2, 'independent child deletion cannot mint a third parent');
  db.questions.put({ schema: 4, id: mapped.id, createdAt: 10, updatedAt: Date.now() + 30, deletedAt: Date.now() + 30, deviceId: 'local' });
  p = await service.previewFile(path); assert.equal(service.apply(p.token, all(p)).imported, 0);
  assert.equal(questions(db).length, 2);
}));
test('an original attachment tombstone forces explicit new parent and remains terminal on repeated restore', () => fixture(async (db, service, path) => {
  db.questionAttachments.deleteForQuestion('q-a', 30, 'local');
  let p = await service.previewFile(path);
  assert.equal(p.items.find(item => item.kind === 'question')!.note, 'question_new_identity');
  assert.equal(service.apply(p.token, all(p)).imported, 2);
  const mapped = questions(db).find(q => q.id !== 'q-a')!;
  db.questionAttachments.deleteForQuestion(mapped.id, Date.now() + 10, 'local');
  p = await service.previewFile(path); assert.equal(service.apply(p.token, all(p)).imported, 0);
  assert.equal(questions(db).length, 2);
  assert.equal('deletedAt' in db.questionAttachments.forQuestion('q-a')!, true);
}));
test('attachment write failure rolls back parent, children and outbox and releases v4 staging', () => fixture(async (db, service, path, dir) => {
  db.resetLocalData();
  const p = await service.previewFile(path), original = db.questionAttachments.put.bind(db.questionAttachments);
  db.questionAttachments.put = () => { throw new Error('disk_failed'); };
  assert.throws(() => service.apply(p.token, all(p)), /disk_failed/);
  assert.equal(db.questions.get('q-a'), null); assert.equal(db.outbox.count(), 0);
  assert.equal(await stages(dir), 0); db.questionAttachments.put = original;
}));
test('staging is released by cancel, replacement, stale, invalid selection, expiry, reset and dispose', () => fixture(async (db, service, path, dir) => {
  let p = await service.previewFile(path); assert.equal(await stages(dir), 1);
  service.cancel(p.token); assert.equal(await stages(dir), 0);
  p = await service.previewFile(path); const replaced = await service.previewFile(path);
  assert.equal(await stages(dir), 1); assert.throws(() => service.apply(p.token, []), /backup_missing/);
  db.state.put('template:change', { id: 'change', name: 'change', text: 'change', updatedAt: 50 }, 50);
  assert.throws(() => service.previewSelection(replaced.token, []), /backup_stale/); assert.equal(await stages(dir), 0);
  p = await service.previewFile(path); assert.throws(() => service.previewSelection(p.token, ['unknown']), /backup_selection/);
  assert.equal(await stages(dir), 0);
  const expiring = new BackupService(db, { deviceId: () => 'local', stagingRoot: dir, previewTtlMs: 20 });
  const expired = await expiring.previewFile(path); await delay(35);
  assert.throws(() => expiring.apply(expired.token, []), /backup_missing/); assert.equal(await stages(dir), 0); expiring.dispose();
  await service.previewFile(path); service.invalidate(); db.resetLocalData(); assert.equal(await stages(dir), 0);
  await service.previewFile(path); service.dispose(); assert.equal(await stages(dir), 0);
  assert.deepEqual(await readdir(dir), ['valid.polyask'], 'original selected backup is never removed');
}));
for (const reason of ['cancel', 'reset', 'dispose'] as const) test(`late import cannot publish after ${reason}`, () => fixture(async (db, service, path, dir) => {
  const guard = service.beginOperation(); let interrupted = false;
  await assert.rejects(service.previewFile(path, () => {
    if (!interrupted && readdirSync(dir).some(name => name.startsWith('polyask-backup-stage-'))) {
      interrupted = true;
      if (reason === 'cancel') service.cancel('pending');
      if (reason === 'reset') { db.questions.invalidateLifecycle(); service.invalidate(); db.resetLocalData(); }
      if (reason === 'dispose') service.dispose();
    }
    guard();
  }), /backup_stale/);
  assert.equal(interrupted, true); assert.equal(await stages(dir), 0);
}));
test('late export after reset cannot replace a user file', () => fixture(async (db, service, path, dir) => {
  const output = join(dir, 'existing.polyask'); await writeFile(output, 'keep');
  const guard = service.beginOperation(); let interrupted = false;
  await assert.rejects(service.exportFile(output, 'complete', () => {
    if (!interrupted && readdirSync(dir).some(name => name.endsWith('.tmp'))) {
      interrupted = true; db.questions.invalidateLifecycle(); service.invalidate(); db.resetLocalData();
    }
    guard();
  }), /backup_stale/);
  assert.equal(interrupted, true); assert.equal((await readdir(dir)).some(name => name.endsWith('.tmp')), false);
  const { readFile } = await import('node:fs/promises'); assert.equal(await readFile(output, 'utf8'), 'keep');
}));

test('an incomplete local BLOB set can be repaired from backup without a new identity', async () => {
  const { DatabaseSync } = await import('node:sqlite');
  const dir = await mkdtemp(join(tmpdir(), 'polyask-repair-backup-'));
  const db = DesktopDatabase.open(join(dir, 'database.sqlite'));
  const raw = new DatabaseSync(join(dir, 'database.sqlite'));
  const service = new BackupService(db, { deviceId: () => 'local', stagingRoot: dir });
  try {
    const q = question(); db.questions.put(q); db.questionAttachments.save(q, [image()]);
    const path = join(dir, 'repair.polyask'); await service.exportFile(path);
    raw.prepare('DELETE FROM question_attachment_items').run();
    const preview = await service.previewFile(path);
    assert.equal(preview.items.find(item => item.kind === 'questionAttachments')!.status, 'conflict');
    assert.equal(service.previewSelection(preview.token, all(preview)).imported, 1);
    assert.equal(service.apply(preview.token, all(preview)).imported, 1);
    assert.deepEqual(db.questionAttachments.readAll(q.id), [image()]); assert.equal(questions(db).length, 1);
  } finally { service.dispose(); raw.close(); db.close(); await rm(dir, { recursive: true, force: true }); }
});

test('different v4 answer selections and later original child tombstones cannot mint a third parent', () => fixture(async (db, service, path) => {
  const { questionAnswerFixture } = await import('./question-fixtures');
  const a = questionAnswerFixture('q-a', 1), b = questionAnswerFixture('q-a', 2);
  db.questions.putAnswer(a); db.questions.putAnswer(b); await service.exportFile(path);
  const remove = (answer: typeof a, time: number) => db.questions.putAnswer({ schema: 4, id: answer.id, questionId: answer.questionId,
    site: answer.site, attempt: answer.attempt, createdAt: answer.createdAt, updatedAt: time, deletedAt: time, deviceId: 'local' });
  remove(a, 30);
  let p = await service.previewFile(path);
  assert.deepEqual(p.items.find(item => item.id === b.id)!.requires, ['question:q-a']);
  assert.equal(service.previewSelection(p.token, [`questionAnswer:${b.id}`]).imported, 0);
  assert.equal(service.apply(p.token, [`questionAnswer:${b.id}`]).imported, 0, 'remapping needs an explicit parent choice');
  p = await service.previewFile(path);
  assert.equal(service.apply(p.token, ['question:q-a', `questionAnswer:${a.id}`]).imported, 2);
  const mapped = questions(db).find(q => q.id !== 'q-a')!;
  p = await service.previewFile(path);
  assert.equal(service.apply(p.token, ['question:q-a', `questionAnswer:${b.id}`, `questionAttachments:${questionAttachmentId('q-a')}`]).imported, 2);
  assert.equal(db.questions.answers(mapped.id).length, 2);
  remove(b, 40); db.questionAttachments.deleteForQuestion('q-a', 50, 'local');
  p = await service.previewFile(path); assert.equal(service.apply(p.token, all(p)).imported, 0);
  const time = Date.now() + 10;
  db.questions.put({ schema: 4, id: mapped.id, createdAt: 10, updatedAt: time, deletedAt: time, deviceId: 'local' });
  p = await service.previewFile(path); assert.equal(service.apply(p.token, ['question:q-a', `questionAnswer:${b.id}`]).imported, 0);
  assert.equal(questions(db).length, 2);
}));
