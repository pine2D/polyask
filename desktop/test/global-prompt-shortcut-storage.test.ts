import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { BackupService } from '../src/main/backup-service';
import { validateBackup } from '../src/main/backup-validation';
import { DesktopDatabase } from '../src/main/database';
import { GlobalPromptShortcutRepository } from '../src/main/global-prompt-shortcut-repository';
import { SyncRepository } from '../src/main/sync-repository';

test('local shortcut fixture is stored only in meta and excluded from state fragments and business backups', () => {
  const fixture = JSON.parse(readFileSync(join(__dirname, 'fixtures/global-prompt-shortcut-local-meta-v1.json'), 'utf8'));
  const db = DesktopDatabase.open(':memory:');
  try {
    db.meta.put('deviceId', 'local');
    const repository = new GlobalPromptShortcutRepository(db.meta);
    assert.equal(repository.read(), fixture.default.globalPromptShortcut);
    repository.write(fixture.enabled.globalPromptShortcut);
    assert.equal(db.meta.get('globalPromptShortcut'), 'Control+Alt+Q');
    assert.equal(db.outbox.ready(0).length, 0);
    const sync = JSON.stringify(new SyncRepository(db).localStateFragment());
    const backup = JSON.stringify(new BackupService(db, { deviceId: () => 'local', now: () => 10 }).export());
    assert.equal(sync.includes('globalPromptShortcut'), false);
    assert.equal(sync.includes('Control+Alt+Q'), false);
    assert.equal(backup.includes('globalPromptShortcut'), false);
    assert.equal(backup.includes('Control+Alt+Q'), false);
    db.resetLocalData();
    for (const key of fixture.resetRemoves) assert.equal(db.meta.has(key), false);
    assert.equal(repository.read(), null);
    assert.equal(db.meta.get('deviceId'), 'local');
  } finally { db.close(); }
});

test('incoming preferences and backups cannot enable a local global shortcut', () => {
  const db = DesktopDatabase.open(':memory:');
  try {
    db.meta.put('deviceId', 'local');
    new SyncRepository(db).applyStateFragments({ remote: { schema: 1, deviceId: 'remote', groups: {}, templates: {}, settings: {
      'polyask.preference.globalPromptShortcut': { value: 'Control+Alt+Q', updatedAt: 10, deviceId: 'remote' }
    } } });
    assert.equal(new GlobalPromptShortcutRepository(db.meta).read(), null);
    assert.throws(() => validateBackup({ format: 'polyask-backup', version: 3, exportedAt: 10,
      entries: [{ kind: 'preference', id: 'globalPromptShortcut', body: { value: 'Control+Alt+Q', updatedAt: 10 } }]
    }), /backup_invalid/);
  } finally { db.close(); }
});
