import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DesktopDatabase } from '../src/main/database';
import { QuestionAttachmentRepository, questionAttachmentId } from '../src/main/question-attachment-repository';
import { OutboxRepository } from '../src/main/outbox-repository';
import { MAX_IMAGE_BYTES, type DesktopImage } from '../src/shared/images';
import { isStoredQuestionAttachmentManifest, isStoredQuestionAttachments, type StoredQuestionAttachments } from '../src/shared/question-attachments';
import { SyncEngine, type SyncDrive } from '../src/main/sync-engine';
import { SyncRepository } from '../src/main/sync-repository';
import { image, question, wire } from './lib/question-attachment-fixtures';

function memory(action: (db: DesktopDatabase) => void) {
  const db = DesktopDatabase.open(':memory:');
  try { action(db); } finally { db.close(); }
}
function file(action: (db: DesktopDatabase, raw: DatabaseSync) => void) {
  const dir = mkdtempSync(join(tmpdir(), 'polyask-images-'));
  const db = DesktopDatabase.open(join(dir, 'data.sqlite'));
  const raw = new DatabaseSync(join(dir, 'data.sqlite'));
  try { action(db, raw); } finally { raw.close(); db.close(); rmSync(dir, { recursive: true, force: true }); }
}

test('original question attachments have an independent persistent schema', () => memory(db => {
  assert.equal(db.configuration().userVersion, 5, 'original attachment storage needs schema 5');
  assert.equal(db.questionAttachments === db.questions.attachments, true);
  assert.equal(questionAttachmentId('q-a'), createHash('sha256').update(JSON.stringify(['questionAttachments', 'q-a'])).digest('hex'));
}));

test('four originals preserve names, exact bytes, EXIF, order and duplicates', () => memory(db => {
  const images = [image('二.png'), image('camera.jpg', 'image/jpeg', 32), image('二.png'), image('last.png')];
  const q = question('q-a', images.length); db.questions.put(q); db.questionAttachments.save(q, images);
  assert.deepEqual(db.questionAttachments.readAll(q.id), images);
  assert.deepEqual(db.questionAttachments.readImage(q.id, 1), images[1]);
  const saved = db.questionAttachments.project(questionAttachmentId(q.id))!;
  assert.equal(saved.schema, 5); assert.equal(isStoredQuestionAttachments(saved), true);
  assert.equal(db.questionAttachments.all().length, 1);
  assert.equal(db.outbox.ready(100).some(op => op.kind === 'questionAttachments'), true);
  assert.throws(() => db.questionAttachments.readImage(q.id, -1));
  assert.throws(() => db.questionAttachments.readImage(q.id, 4));
}));

test('metadata methods never select original BLOB payloads', () => file((db, raw) => {
  const q = question(); db.questions.put(q); db.questionAttachments.save(q, [image()]);
  const sql: string[] = [];
  const observed = new Proxy(raw, { get(target, key) {
    if (key === 'prepare') return (query: string) => { sql.push(query); return target.prepare(query); };
    const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value;
  } });
  const repo = new QuestionAttachmentRepository(observed, new OutboxRepository(observed));
  const manifest = repo.get(questionAttachmentId(q.id))!;
  assert.equal(isStoredQuestionAttachmentManifest(manifest), true);
  assert.equal(JSON.stringify(manifest).includes('base64'), false);
  assert.equal(repo.forQuestion(q.id)?.id, manifest.id); assert.equal(repo.all().length, 1);
  assert.equal(sql.some(query => /question_attachment_items|\bdata\b/i.test(query)), false);
}));

test('exact 10 MiB is accepted while aggregate overflow and five images are rejected atomically', () => memory(db => {
  const q = question('max', 4); const images = Array.from({ length: 4 }, (_, i) => image(`${i}.png`, 'image/png', MAX_IMAGE_BYTES / 4));
  db.questions.put(q); db.questionAttachments.save(q, images);
  assert.equal(db.questionAttachments.readAll(q.id).reduce((n, img) => n + img.size, 0), MAX_IMAGE_BYTES);
  const q2 = question('over', 4); db.questions.put(q2);
  assert.throws(() => db.questionAttachments.save(q2, [...images.slice(0, 3), image('4.png', 'image/png', MAX_IMAGE_BYTES / 4 + 1)]));
  assert.equal(db.questionAttachments.forQuestion(q2.id), null);
  assert.throws(() => db.questionAttachments.put({ ...wire('five'), images: Array(5).fill(wire().images[0]) }));
  assert.equal(db.questionAttachments.forQuestion('five'), null);
}));

test('strict wire and metadata validation rejects hash, MIME, base64, name, paths and extra fields', () => memory(db => {
  const good = wire();
  for (const change of [ { sha256: '0'.repeat(64) }, { type: 'image/jpeg' }, { size: 999 },
    { base64: good.images[0].base64 + '=' }, { base64: '!!!!' }, { name: '../x.png' },
    { name: 'C:\\secret.png' }, { name: '.' }, { name: '\u0000bad.png' }, { name: '' }, { name: 'x'.repeat(129) }, { extra: 'bad' } ]) {
    assert.throws(() => db.questionAttachments.put({ ...good, images: [{ ...good.images[0], ...change }] } as StoredQuestionAttachments));
    assert.equal(db.questionAttachments.all().length, 0);
  }
  assert.throws(() => db.questionAttachments.put({ ...good, id: '0'.repeat(64) }));
  assert.throws(() => db.questionAttachments.put({ ...good, questionId: 'foreign' }));
  assert.throws(() => db.questionAttachments.put({ ...good, extra: true } as StoredQuestionAttachments));
  assert.equal(db.outbox.count(), 0);
}));

test('attachment identity, creation time, contents and parent image count are immutable', () => memory(db => {
  const q = question(); db.questions.put(q); db.questionAttachments.save(q, [image()]);
  const saved = db.questionAttachments.project(questionAttachmentId(q.id))!;
  assert.throws(() => db.questionAttachments.put(wire(q.id, [image('changed.png')])));
  assert.throws(() => db.questionAttachments.put({ ...saved, createdAt: 9 }));
  assert.throws(() => db.questionAttachments.save(q, [image(), image()]));
  const absent = question('not-stored'); assert.throws(() => db.questionAttachments.save(absent, [image()]));
  assert.deepEqual(db.questionAttachments.readAll(q.id), [image()]);
}));

test('orphan child waits for live parent and read/project reject mismatched parent count', () => memory(db => {
  const value = wire(); db.questionAttachments.put(value, false);
  assert.equal(db.questionAttachments.forQuestion('q-a')?.id, value.id);
  assert.throws(() => db.questionAttachments.readAll('q-a'));
  assert.equal(db.questionAttachments.project(value.id)?.id, value.id);
  db.questions.put(question('q-a', 2));
  assert.throws(() => db.questionAttachments.readAll('q-a'));
  assert.throws(() => db.questionAttachments.project(value.id));
}));

test('parent deletion removes BLOBs, queues terminal tombstone and rejects later live data', () => file((db, raw) => {
  const q = question(); db.questions.put(q); db.questionAttachments.save(q, [image()]);
  const live = db.questionAttachments.project(questionAttachmentId(q.id))!;
  db.questions.delete(q.id, 30, 'device-b');
  assert.equal('deletedAt' in db.questionAttachments.forQuestion(q.id)!, true);
  assert.equal('images' in db.questionAttachments.forQuestion(q.id)!, false);
  assert.equal(Number(raw.prepare('SELECT COUNT(*) AS n FROM question_attachment_items').get()!.n), 0);
  assert.throws(() => db.questionAttachments.readAll(q.id));
  db.questionAttachments.put({ ...live, updatedAt: 500 }, false);
  assert.equal('deletedAt' in db.questionAttachments.forQuestion(q.id)!, true);
  assert.equal(db.outbox.ready(100).some(op => op.kind === 'questionAttachments'), true);
}));

test('late orphan under deleted parent becomes terminal tombstone, independent of timestamps', () => memory(db => {
  const q = question(); db.questions.put(q); db.questions.delete(q.id, 20, 'device-b');
  db.questionAttachments.put({ ...wire(), updatedAt: 500 }, false);
  const deleted = db.questionAttachments.forQuestion(q.id)!;
  assert.equal('deletedAt' in deleted, true); assert.equal('images' in deleted, false);
  const tombstone = { schema: 5 as const, id: wire('other').id, questionId: 'other', createdAt: 10, updatedAt: 20, deletedAt: 20, deviceId: 'b' };
  db.questionAttachments.put(wire('other')); db.questionAttachments.put(tombstone, false);
  db.questionAttachments.put({ ...wire('other'), updatedAt: 1000 }, false);
  assert.equal('deletedAt' in db.questionAttachments.forQuestion('other')!, true);
}));

test('parent delete transaction rolls back parent, child BLOB removal and both outboxes on failure', () => file((db, raw) => {
  const q = question(); db.questions.put(q); db.questionAttachments.save(q, [image()]);
  const before = db.outbox.ready(100).map(op => [op.key, op.revision]);
  raw.exec("CREATE TRIGGER deny_image_delete BEFORE DELETE ON question_attachment_items BEGIN SELECT RAISE(ABORT, 'disk failure'); END");
  assert.throws(() => db.questions.delete(q.id, 30, 'b'));
  assert.equal('deletedAt' in db.questions.get(q.id)!, false);
  assert.deepEqual(db.questionAttachments.readAll(q.id), [image()]);
  assert.deepEqual(db.outbox.ready(100).map(op => [op.key, op.revision]), before);
}));

test('read/project detects corrupted, missing and additional BLOBs instead of silent downgrade', () => file((db, raw) => {
  const q = question(); db.questions.put(q); db.questionAttachments.save(q, [image()]);
  raw.prepare('UPDATE question_attachment_items SET data=?').run(Buffer.from('bad'));
  assert.throws(() => db.questionAttachments.readImage(q.id, 0));
  assert.throws(() => db.questionAttachments.project(questionAttachmentId(q.id)));
  raw.exec('DELETE FROM question_attachment_items');
  assert.throws(() => db.questionAttachments.readAll(q.id));
  db.questionAttachments.put(wire(), false);
  raw.prepare('INSERT INTO question_attachment_items VALUES(?,?,?)').run(questionAttachmentId(q.id), 1, Buffer.from('extra'));
  assert.throws(() => db.questionAttachments.readImage(q.id, 0));
}));

test('reset clears attachment tables, image-sync meta and outbox while preserving deviceId', () => file((db, raw) => {
  const q = question(); db.questions.put(q); db.questionAttachments.save(q, [image()]);
  db.meta.put('deviceId', 'a'); db.meta.put('questionImageSyncEnabled', true);
  db.resetLocalData(); assert.equal(db.questionAttachments.all().length, 0);
  assert.equal(Number(raw.prepare('SELECT COUNT(*) AS n FROM question_attachment_items').get()!.n), 0);
  assert.equal(db.outbox.count(), 0); assert.equal(db.meta.get('questionImageSyncEnabled'), null); assert.equal(db.meta.get('deviceId'), 'a');
}));

test('schema 5 live and tombstone fixtures validate and project without rewriting schema 1–4', () => memory(db => {
  for (const name of ['schema5-question-attachments', 'schema5-question-attachments-tombstone']) {
    const value = JSON.parse(readFileSync(join(__dirname, 'fixtures', `${name}.json`), 'utf8')).body;
    assert.equal(isStoredQuestionAttachments(value), true); db.questionAttachments.put(value, false);
    assert.deepEqual(db.questionAttachments.project(value.id), value);
  }
}));

test('attachment queue remains pending until image sync lands and cannot starve text operations', () => memory(db => {
  db.meta.put('deviceId', 'a');
  for (let i = 0; i < 110; i++) db.questionAttachments.put(wire(`image-${i}`));
  const sync = new SyncRepository(db); assert.equal(sync.nextAt(), null); assert.equal(sync.ready(100).length, 0);
  db.questions.put(question('text', 0)); assert.equal(sync.ready(100).length, 1);
  assert.equal(sync.ready(100)[0].kind, 'question'); assert.equal(sync.nextAt(), 0);
  assert.equal(db.outbox.ready(100, 200).filter(op => op.kind === 'questionAttachments').length, 110);
}));

test('an identical same-version wire repairs damaged local bytes without reviving tombstones', () => file((db, raw) => {
  const q = question(); db.questions.put(q); const value = wire(); db.questionAttachments.put(value);
  raw.prepare('UPDATE question_attachment_items SET data=?').run(Buffer.from('corrupt'));
  db.questionAttachments.put(value, false);
  assert.doesNotThrow(() => db.questionAttachments.readAll(q.id));
  assert.deepEqual(db.questionAttachments.readAll(q.id), [image()]);
  raw.exec('DELETE FROM question_attachment_items');
  db.questionAttachments.put(value, false);
  assert.deepEqual(db.questionAttachments.readAll(q.id), [image()]);
  db.questions.delete(q.id, 30, 'b'); db.questionAttachments.put(value, false);
  assert.equal('deletedAt' in db.questionAttachments.forQuestion(q.id)!, true);
  assert.equal(Number(raw.prepare('SELECT COUNT(*) AS n FROM question_attachment_items').get()!.n), 0);
}));

test('deleting a parent with a missing image set still writes the deterministic child tombstone', () => memory(db => {
  const q = question(); db.questions.put(q); db.questions.delete(q.id, 30, 'b');
  const deleted = db.questionAttachments.forQuestion(q.id);
  assert.equal(deleted !== null, true, 'failed or not-yet-downloaded originals still require a deletion signal');
  assert.equal('deletedAt' in deleted!, true); assert.equal('images' in deleted!, false);
  assert.equal(db.outbox.ready(100).some(op => op.kind === 'questionAttachments'), true);
}));

test('reordered metadata keys preserve immutable image identity and canonical base64 rejects nonzero padding bits', () => memory(db => {
  const value = wire(); db.questionAttachments.put(value);
  const original = value.images[0];
  const img = { base64: original.base64, sha256: original.sha256, size: original.size, type: original.type, name: original.name };
  assert.doesNotThrow(() => db.questionAttachments.put({ ...value, images: [img] }, false));
  const noncanonical = original.base64.slice(0, -3) + 'x==';
  assert.throws(() => db.questionAttachments.put({ ...value, images: [{ ...original, base64: noncanonical }] }));
}));


test('schema 4 migration preserves original question JSON and identity without user-profile access', () => {
  const dir = mkdtempSync(join(tmpdir(), 'polyask-schema4-images-')); const path = join(dir, 'data.sqlite');
  const old = new DatabaseSync(path); const q = question(); const body = JSON.stringify(q);
  old.exec('CREATE TABLE questions(id TEXT PRIMARY KEY,body TEXT NOT NULL,sort_time INTEGER NOT NULL,deleted_at INTEGER); CREATE TABLE meta(key TEXT PRIMARY KEY,body TEXT NOT NULL); PRAGMA user_version=4');
  old.prepare('INSERT INTO questions VALUES(?,?,?,NULL)').run(q.id, body, q.createdAt);
  old.prepare('INSERT INTO meta VALUES(?,?)').run('deviceId', JSON.stringify('preserved-device')); old.close();
  const db = DesktopDatabase.open(path);
  try {
    assert.equal(db.configuration().userVersion, 5); assert.equal(JSON.stringify(db.questions.get(q.id)), body);
    assert.equal(db.meta.get('deviceId'), 'preserved-device'); assert.equal(db.questionAttachments.all().length, 0);
    assert.equal(db.outbox.count(), 0); db.questionAttachments.save(q, [image()]);
    assert.deepEqual(db.questionAttachments.readAll(q.id), [image()]);
  } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('a real sync-engine flush uploads text and retains all original-image operations locally', async () => {
  const db = DesktopDatabase.open(':memory:'); db.meta.put('deviceId', 'a');
  const repo = new SyncRepository(db); repo.saveConfig({ connected: true });
  const uploaded: string[] = [];
  const drive: SyncDrive = {
    listFiles: async () => [], getStartToken: async () => 'start',
    listChanges: async () => ({ changes: [], newStartPageToken: 'next' }),
    download: async () => { throw new Error('no remote images should be read'); },
    upsert: async (_fileId, name, properties) => { uploaded.push(properties.kind); return { id: `uploaded-${uploaded.length}`, name, appProperties: properties }; },
    clearAll: async () => {}
  };
  const engine = new SyncEngine({ repository: repo, drive, auth: { configured: () => true, securePersistence: () => true,
    connect: async () => {}, disconnect: async () => {} } });
  try {
    for (let i = 0; i < 110; i++) db.questionAttachments.put(wire(`image-${i}`));
    db.questions.put(question('text', 0));
    await engine.syncNow('manual');
    assert.equal(uploaded.includes('question'), true); assert.equal(uploaded.includes('questionAttachments'), false);
    assert.equal(db.outbox.ready(Date.now(), 200).filter(op => op.kind === 'questionAttachments').length, 110);
    assert.equal(db.outbox.ready(Date.now(), 200).some(op => op.kind === 'question'), false);
  } finally { engine.dispose(); db.close(); }
});
