import { seedLargeBackupImages } from './lib/backup-image-fixtures';
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm, stat, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DesktopDatabase } from '../src/main/database';
import { BackupService } from '../src/main/backup-service';
import { question } from './lib/question-attachment-fixtures';

async function setup(run: (db: DesktopDatabase, service: BackupService, dir: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), 'polyask-v4-test-'));
  const db = DesktopDatabase.open(':memory:');
  const service = new BackupService(db, { deviceId: () => 'local', stagingRoot: dir });
  try { await run(db, service, dir); }
  finally { service.dispose?.(); db.close(); await rm(dir, { recursive: true, force: true }); }
}
test('v4 streams more than 32 MiB, restores originals and excludes device sync settings', () => setup(async (db, service, dir) => {
  const started = Date.now();
  const imageSize = seedLargeBackupImages(db);
  db.meta.put('questionImageSyncEnabled', true); db.meta.put('questionImageSyncAcknowledged', true);
  const path = join(dir, 'large.polyask');
  assert.equal(typeof service.exportFile, 'function', 'production needs the bounded v4 export entry point');
  let reads = 0, largest = 0;
  const read = db.questionAttachments.readBytes.bind(db.questionAttachments);
  db.questionAttachments.readBytes = id => { const bytes = read(id); reads++; largest = Math.max(largest, bytes.reduce((sum, b) => sum + b.length, 0)); return bytes; };
  db.questionAttachments.project = () => { throw new Error('whole base64 wire projection forbidden'); };
  db.questionAttachments.readAll = () => { throw new Error('base64 read forbidden for export'); };
  await service.exportFile(path);
  assert.equal(reads, 8, 'preflight and stream each read one set');
  assert.equal(largest, imageSize, 'maximum single read is one bounded set');
  assert.equal((await stat(path)).size > 32 * 1024 * 1024, true);
  const other = DesktopDatabase.open(':memory:');
  const restore = new BackupService(other, { deviceId: () => 'restored', stagingRoot: dir });
  try {
    const preview = await restore.previewFile(path);
    assert.equal(JSON.stringify(preview).includes('base64'), false);
    assert.equal(preview.items.filter(item => item.kind === 'questionAttachments').length, 4);
    assert.equal(restore.apply(preview.token, preview.items.map(item => item.key)).imported, 8);
    for (let i = 0; i < 4; i++) assert.equal(other.questionAttachments.readAll(`large-${i}`)[0].size, imageSize);
    assert.equal(other.meta.get('questionImageSyncEnabled'), null);
    assert.equal(other.meta.get('questionImageSyncAcknowledged'), null);
    assert.deepEqual(await readdir(dir), ['large.polyask']);
    console.log(`v4 >32MiB roundtrip: ${(await stat(path)).size} bytes, ${Date.now() - started} ms`);
  } finally { restore.dispose(); other.close(); }
}));
test('missing originals require explicit text-only export and preserve omission metadata', () => setup(async (db, service, dir) => {
  db.questions.put(question('missing', 2));
  const missing = await service.missingOriginals();
  assert.equal(missing[0].questionId, 'missing'); assert.equal(missing[0].count, 2); assert.deepEqual(missing[0].images, []);
  await assert.rejects(service.exportFile(join(dir, 'bad.polyask')), /backup_images_missing/);
  const path = join(dir, 'text.polyask'); await service.exportFile(path, 'text-only');
  const preview = await service.previewFile(path);
  assert.equal(preview.omissions?.[0].count, 2);
  service.cancel(preview.token);
  assert.equal((await readFile(path)).subarray(0, 17).toString().startsWith('POLYASK-BACKUP-4\n'), true);
  assert.deepEqual(await readdir(dir), ['text.polyask']);
}));

test('frozen v4 container restores a valid PNG with exact original bytes', () => setup(async (db, service) => {
  const { PNG } = await import('./lib/history-image-fixtures');
  const { createHash } = await import('node:crypto');
  assert.equal(createHash('sha256').update(await readFile(join(__dirname, 'fixtures/backup-format4.polyask'))).digest('hex'), '56864beeca35b925a7e08ebc04e182d1e49500c45265ab010597be61efd4b2c9');
  const p = await service.previewFile(join(__dirname, 'fixtures/backup-format4.polyask'));
  assert.equal(p.items.length, 2);
  service.apply(p.token, p.items.map(item => item.key));
  const img = db.questionAttachments.readAll('backup-v4-original')[0];
  assert.equal(img.name, '原图.png'); assert.equal(img.dataUrl, `data:image/png;base64,${PNG}`);
}));
