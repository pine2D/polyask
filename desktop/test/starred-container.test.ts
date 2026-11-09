import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DesktopDatabase } from '../src/main/database';
import { BackupService } from '../src/main/backup-service';
import { readBackupContainer } from '../src/main/backup-container';
import { BACKUP_MAGIC, BACKUP_V5_MAGIC } from '../src/shared/backup';
import { image, question } from './lib/question-attachment-fixtures';

test('v6 file restores stars and original image bytes together and rejects a v5 disguise', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'polyask-star-backup-'));
  const source = DesktopDatabase.open(':memory:'), target = DesktopDatabase.open(':memory:');
  const exporter = new BackupService(source, { deviceId: () => 'local' });
  const importer = new BackupService(target, { deviceId: () => 'remote', stagingRoot: dir });
  try {
    const q = question(); source.questions.put(q); source.questionAttachments.save(q, [image()]);
    source.questions.setFavorite(q.id, true, 300, 'local');
    const path = join(dir, 'star.polyask'); await exporter.exportFile(path);
    const bytes = await readFile(path);
    assert.equal(bytes.subarray(0, Buffer.byteLength(BACKUP_MAGIC)).toString(), BACKUP_MAGIC);
    const preview = await importer.previewFile(path);
    importer.apply(preview.token, preview.items.map(i => i.key));
    assert.equal(target.questions.search({ favorite: true }).items[0].id, q.id);
    assert.deepEqual(target.questionAttachments.readAll(q.id), [image()]);
    const wrong = join(dir, 'wrong.polyask');
    await writeFile(wrong, Buffer.concat([Buffer.from(BACKUP_V5_MAGIC), bytes.subarray(Buffer.byteLength(BACKUP_MAGIC))]));
    await assert.rejects(readBackupContainer(wrong), /backup_version/);
  } finally { exporter.dispose(); importer.dispose(); source.close(); target.close(); await rm(dir, { recursive: true, force: true }); }
});
