import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { BackupService } from '../src/main/backup-service';
import { validateBackup } from '../src/main/backup-validation';
import { DesktopDatabase } from '../src/main/database';
import { CommandPaletteShortcutRepository } from '../src/main/command-palette-shortcut-repository';
import { CommandPaletteShortcutRuntime } from '../src/main/command-palette-shortcut';
import { SyncRepository } from '../src/main/sync-repository';

test('local palette fixture never enters outbox, sync or backup and reset keeps device identity', () => {
  const fixture = JSON.parse(readFileSync(join(__dirname, 'fixtures/command-palette-shortcut-local-meta-v1.json'), 'utf8'));
  const db = DesktopDatabase.open(':memory:'); const backup = new BackupService(db, { deviceId: () => 'local', now: () => 10 });
  try {
    db.meta.put('deviceId', 'local'); const repository = new CommandPaletteShortcutRepository(db.meta);
    assert.equal(repository.read(), fixture.default.commandPaletteShortcut);
    repository.write(fixture.enabled.commandPaletteShortcut);
    assert.equal(db.meta.get('commandPaletteShortcut'), 'obsidian'); assert.equal(db.outbox.ready(0).length, 0);
    for (const value of [new SyncRepository(db).localStateFragment(), backup.export()]) {
      assert.equal(JSON.stringify(value).includes('commandPaletteShortcut'), false);
      assert.equal(JSON.stringify(value).includes('obsidian'), false);
    }
    const preview = backup.preview(backup.export()); backup.apply(preview.token, []);
    assert.equal(repository.read(), 'obsidian', 'restoring business data leaves this machine choice intact');
    const runtime = new CommandPaletteShortcutRuntime({ repository, transaction: action => db.transaction(action),
      prepare: () => ({ commit() {}, rollback() {} }), publish() {} }); runtime.restore();
    db.resetLocalData(); assert.equal(runtime.refreshAfterReset().mode, 'standard');
    for (const key of fixture.resetRemoves) assert.equal(db.meta.has(key), false);
    assert.equal(db.meta.get('deviceId'), 'local'); runtime.dispose();
  } finally { backup.dispose(); db.close(); }
});
test('remote preferences and imported backup cannot change the palette binding', () => {
  const db = DesktopDatabase.open(':memory:');
  try {
    db.meta.put('deviceId', 'local');
    const repository = new CommandPaletteShortcutRepository(db.meta); repository.write('standard');
    new SyncRepository(db).applyStateFragments({ remote: { schema: 1, deviceId: 'remote', groups: {}, templates: {}, settings: {
      'polyask.preference.commandPaletteShortcut': { value: 'obsidian', updatedAt: 10, deviceId: 'remote' }
    } } });
    assert.equal(repository.read(), 'standard');
    assert.throws(() => validateBackup({ format: 'polyask-backup', version: 3, exportedAt: 10,
      entries: [{ kind: 'preference', id: 'commandPaletteShortcut', body: { value: 'obsidian', updatedAt: 10 } }] }), /backup_invalid/);
  } finally { db.close(); }
});
test('real SQLite transaction rolls back a menu commit failure', () => {
  const db = DesktopDatabase.open(':memory:'); let fail = false, menu = 'standard';
  try {
    db.meta.put('deviceId', 'local');
    const repository = new CommandPaletteShortcutRepository(db.meta); repository.write('standard');
    const runtime = new CommandPaletteShortcutRuntime({ repository, transaction: action => db.transaction(action), publish() {},
      prepare: mode => { const old = menu; return { commit: () => { menu = mode; if (fail) throw Error('menu failed'); }, rollback: () => { menu = old; } }; } });
    runtime.restore(); fail = true;
    assert.equal(runtime.configure('obsidian').error, 'command_shortcut_apply_failed');
    assert.equal(repository.read(), 'standard'); assert.equal(menu, 'standard'); assert.equal(db.outbox.ready(0).length, 0);
  } finally { db.close(); }
});
