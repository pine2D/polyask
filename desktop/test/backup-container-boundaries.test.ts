import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm, readFile, readdir, writeFile, open } from 'node:fs/promises';
import { join } from 'node:path';
import { readdirSync, statSync } from 'node:fs';
import { backupContainerDocument } from '../src/main/backup-export';
import { tmpdir } from 'node:os';
import { DesktopDatabase } from '../src/main/database';
import { BackupService } from '../src/main/backup-service';
import { BACKUP_MAGIC, BACKUP_CONTAINER_MAX_BYTES, BACKUP_MAX_BYTES } from '../src/shared/backup';
import { readBackupContainer, writeBackupContainer } from '../src/main/backup-container';
import { image, question } from './lib/question-attachment-fixtures';

async function fixture(run: (path: string, dir: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), 'polyask-container-boundary-'));
  const db = DesktopDatabase.open(':memory:');
  const service = new BackupService(db, { deviceId: () => 'local', stagingRoot: dir });
  try {
    const q = question(); db.questions.put(q); db.questionAttachments.save(q, [image()]);
    const path = join(dir, 'valid.polyask'); await service.exportFile(path);
    await run(path, dir);
  } finally { service.dispose(); db.close(); await rm(dir, { recursive: true, force: true }); }
}
const offset = Buffer.byteLength(BACKUP_MAGIC);
function parts(bytes: Buffer): { manifest: any; payload: Buffer } {
  const size = bytes.readUInt32BE(offset);
  return { manifest: JSON.parse(bytes.subarray(offset + 4, offset + 4 + size).toString()), payload: bytes.subarray(offset + 4 + size) };
}
function frame(manifest: unknown, payload: Buffer): Buffer {
  const json = Buffer.from(JSON.stringify(manifest)), size = Buffer.alloc(4); size.writeUInt32BE(json.length);
  return Buffer.concat([Buffer.from(BACKUP_MAGIC), size, json, payload]);
}
const mutations: Array<[string, (m: any) => void]> = [
  ['path traversal', m => { m.payloads[0].key = '../escape.png'; }],
  ['absolute path', m => { m.payloads[0].key = '/tmp/escape.png'; }],
  ['duplicate key', m => { m.payloads.push(m.payloads[0]); }],
  ['wrong length', m => { m.payloads[0].size++; }],
  ['wrong hash', m => { m.payloads[0].sha256 = '0'.repeat(64); }],
  ['wrong type', m => { m.entries[1].body.images[0].type = 'image/jpeg'; }],
  ['wrong hash in both declarations', m => { m.payloads[0].sha256 = m.entries[1].body.images[0].sha256 = '0'.repeat(64); }],
  ['missing parent', m => { m.entries = m.entries.slice(1); }],
  ['over four originals', m => { m.entries[1].body.images = Array(5).fill(m.entries[1].body.images[0]); }],
  ['image path name', m => { m.entries[1].body.images[0].name = '../escape.png'; }],
  ['count mismatch', m => { m.entries[0].body.inputImageCount = 2; }],
  ['missing required payload', m => { m.payloads = []; }],
  ['missing attachment without omission', m => { m.entries = m.entries.slice(0, 1); m.payloads = []; }],
  ['duplicate parent', m => { m.entries.push(m.entries[0]); }],
  ['too many entries', m => { m.entries = Array(20001).fill(m.entries[0]); }],
  ['duplicate omission', m => { m.entries = m.entries.slice(0, 1); m.payloads = []; m.omissions = [{ questionId: 'q-a', count: 1, images: [] }, { questionId: 'q-a', count: 1, images: [] }]; }],
  ['hidden device preference', m => { m.entries.push({ kind: 'preference', id: 'questionImageSyncEnabled', body: { value: true, updatedAt: 10 } }); }],
];
for (const [name, change] of mutations) test(`v4 rejects ${name} before preview and removes staging`, () => fixture(async (path, dir) => {
  const { manifest, payload } = parts(await readFile(path)); change(manifest);
  const bad = join(dir, 'bad.polyask'); await writeFile(bad, frame(manifest, payload));
  await assert.rejects(readBackupContainer(bad, { stagingRoot: dir }), /backup_(invalid|dependency)/);
  assert.deepEqual((await readdir(dir)).sort(), ['bad.polyask', 'valid.polyask']);
}));
test('v4 rejects truncated, trailing, binary corruption, UTF8 corruption, oversize and JSON masquerade', () => fixture(async (path, dir) => {
  const valid = await readFile(path), { manifest } = parts(valid);
  const changed = Buffer.from(valid); changed[changed.length - 1] ^= 1;
  const utf8 = Buffer.from(valid); utf8[offset + 5] = 255;
  for (const bytes of [valid.subarray(0, -1), Buffer.concat([valid, Buffer.from('x')]), changed, utf8, Buffer.from(JSON.stringify(manifest))]) {
    const bad = join(dir, 'bad.polyask'); await writeFile(bad, bytes);
    await assert.rejects(readBackupContainer(bad, { stagingRoot: dir }), /backup_invalid/);
    assert.equal((await readdir(dir)).some(name => name.startsWith('polyask-backup-stage-')), false);
  }
  const bad = join(dir, 'bad.polyask'); const file = await open(bad, 'w');
  try { await file.truncate(BACKUP_CONTAINER_MAX_BYTES + 1); } finally { await file.close(); }
  await assert.rejects(readBackupContainer(bad), /backup_too_large/);
  const header = Buffer.concat([Buffer.from(BACKUP_MAGIC), Buffer.alloc(4)]); header.writeUInt32BE(BACKUP_MAX_BYTES + 1, offset);
  await writeFile(bad, header); await assert.rejects(readBackupContainer(bad), /backup_too_large/);
}));
test('late export read failure preserves destination and removes only its own temp file', () => fixture(async (path, dir) => {
  const parsed = await readBackupContainer(path, { stagingRoot: dir });
  try {
    const destination = join(dir, 'existing.polyask'); await writeFile(destination, 'keep');
    let calls = 0;
    await assert.rejects(writeBackupContainer(destination, parsed.staging!.document, () => { calls++; throw new Error('unavailable'); }), /backup_write_failed/);
    assert.equal(calls, 1); assert.equal(await readFile(destination, 'utf8'), 'keep');
    assert.equal((await readdir(dir)).some(name => name.endsWith('.tmp')), false);
  } finally { parsed.staging?.dispose(); }
}));

test('the stream completes the previous set before reading the next set', () => fixture(async (_path, dir) => {
  const db = DesktopDatabase.open(':memory:');
  const service = new BackupService(db, { deviceId: () => 'local' });
  try {
    for (const id of ['one', 'two', 'three']) { const q = question(id); db.questions.put(q); db.questionAttachments.save(q, [image()]); }
    const document = backupContainerDocument(db, service.export(), false);
    const sizes: number[] = [];
    await writeBackupContainer(join(dir, 'stream.polyask'), document, entry => {
      const temporary = readdirSync(dir).find(name => name.endsWith('.tmp'))!;
      sizes.push(statSync(join(dir, temporary)).size);
      return db.questionAttachments.readBytes(String(entry.body.questionId));
    });
    assert.equal(sizes.length, 3);
    assert.equal(sizes[1] - sizes[0], 16); assert.equal(sizes[2] - sizes[1], 16);
  } finally { service.dispose(); db.close(); }
}));

test('declared binary total above 512 MiB is rejected without allocating its payload', () => fixture(async (path, dir) => {
  const { manifest } = parts(await readFile(path));
  const { questionAttachmentId } = await import('../src/main/question-attachment-repository');
  const questionEntry = manifest.entries[0], attachment = manifest.entries[1];
  manifest.entries = []; manifest.payloads = [];
  for (let index = 0; index < 60; index++) {
    const id = `oversized-${index}`, setId = questionAttachmentId(id);
    const metadata = { ...attachment.body.images[0], size: 9 * 1024 * 1024 };
    manifest.entries.push({ ...questionEntry, id, body: { ...questionEntry.body, id } },
      { kind: 'questionAttachments', id: setId, body: { ...attachment.body, id: setId, questionId: id, images: [metadata] } });
    manifest.payloads.push({ key: `images/${index}.bin`, setId, index: 0, size: metadata.size, sha256: metadata.sha256 });
  }
  const bad = join(dir, 'oversized.polyask'); await writeFile(bad, frame(manifest, Buffer.alloc(0)));
  await assert.rejects(readBackupContainer(bad, { stagingRoot: dir }), /backup_too_large/);
  assert.equal((await readdir(dir)).some(name => name.startsWith('polyask-backup-stage-')), false);
}));
