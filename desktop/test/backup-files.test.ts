import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm, truncate, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readBackupFile } from '../src/main/backup-files';
import { BACKUP_MAX_BYTES } from '../src/shared/backup';

test('legacy backup reader accepts JSON and rejects invalid, oversized and missing files', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'polyask-backup-'));
  const path = join(directory, 'backup.json');
  try {
    const document = { format: 'polyask-backup', version: 1, exportedAt: 100, entries: [] };
    await writeFile(path, '\uFEFF' + JSON.stringify(document));
    assert.deepEqual(await readBackupFile(path), document);
    await writeFile(path, 'not json');
    await assert.rejects(readBackupFile(path), /backup_invalid/);
    await truncate(path, BACKUP_MAX_BYTES + 1);
    await assert.rejects(readBackupFile(path), /backup_too_large/);
    await assert.rejects(readBackupFile(join(directory, 'missing')), /backup_read_failed/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
