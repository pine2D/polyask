import assert from 'node:assert/strict';
import test from 'node:test';
import { DesktopDatabase } from '../src/main/database';
import { PreferencesRepository } from '../src/main/preferences-repository';
import { projectPreferences, applyPreferences } from '../src/main/sync-preferences';
import { BackupService } from '../src/main/backup-service';
import { resolveUiTheme, UI_THEME_IDS } from '../src/shared/ui-theme';
import { readSource } from './fixtures';

function device(id: string) {
  const db = DesktopDatabase.open(':memory:');
  db.meta.put('deviceId', id);
  return { db, preferences: new PreferencesRepository(db.state, db.meta),
    backup: new BackupService(db, { deviceId: () => id }) };
}

test('each built-in theme round-trips through shared preferences, device overrides and backup', () => {
  const writer = device('writer'), reader = device('reader');
  try {
    writer.preferences.setFollowing('display', true);
    for (const id of UI_THEME_IDS) {
      writer.preferences.set('uiTheme', id);
      reader.preferences.setFollowing('display', false);
      const local = id === 'pocket' ? 'proof' : 'pocket';
      reader.preferences.set('uiTheme', local);
      applyPreferences(reader.db.state, projectPreferences(writer.db.state));
      assert.equal(reader.preferences.snapshot().values.uiTheme, local);
      reader.preferences.setFollowing('display', true);
      assert.equal(reader.preferences.snapshot().values.uiTheme, id);
      const backup = writer.backup.export();
      reader.db.resetLocalData();
      reader.backup.apply(reader.backup.preview(backup).token, ['preference:uiTheme']);
      reader.preferences.setFollowing('display', true);
      assert.equal(reader.preferences.snapshot().values.uiTheme, id);
    }
  } finally {
    writer.backup.dispose(); reader.backup.dispose(); writer.db.close(); reader.db.close();
  }
});

test('a future skin survives density edits, device overrides and a shared backup/restore round trip', () => {
  const a = device('reader'), b = device('writer');
  const key = 'polyask.preference.uiTheme';
  try {
    assert.equal(a.preferences.snapshot().values.uiTheme, 'platinum');
    assert.equal(a.db.outbox.count(), 0);
    a.preferences.set('uiTheme', 'minimal');
    assert.equal(a.db.outbox.count(), 0, 'device-only edit');
    assert.equal(a.backup.export().entries.some(e => e.id === 'uiTheme'), false);
    const { settings } = JSON.parse(readSource('test/fixtures/schema1-state-ui-theme.json')).body;
    applyPreferences(a.db.state, settings);
    a.preferences.setFollowing('display', true);
    assert.deepEqual(projectPreferences(a.db.state)[key], settings[key]);

    b.preferences.setFollowing('display', true);
    b.preferences.set('uiTheme', 'future-paper');
    const future = projectPreferences(b.db.state)[key];
    applyPreferences(a.db.state, { [key]: future });
    assert.equal(a.preferences.snapshot().values.uiTheme, 'future-paper');
    assert.equal(resolveUiTheme(a.preferences.snapshot().values.uiTheme), 'platinum');
    a.preferences.set('density', 'comfortable');
    a.preferences.setFollowing('display', false);
    assert.equal(a.preferences.snapshot().values.uiTheme, 'future-paper');
    a.preferences.set('uiTheme', 'minimal');
    assert.deepEqual(projectPreferences(a.db.state)[key], future);
    assert.equal(a.preferences.snapshot().values.uiTheme, 'minimal');
    a.preferences.setFollowing('display', true);
    assert.deepEqual(projectPreferences(a.db.state)[key], future);
    const backup = a.backup.export();
    assert.equal(backup.entries.find(e => e.id === 'uiTheme')?.body.value, 'future-paper');
    a.db.resetLocalData();
    assert.equal(a.preferences.snapshot().values.uiTheme, 'platinum');
    assert.equal(a.db.meta.get('deviceId'), 'reader');
    const preview = a.backup.preview(backup);
    a.backup.apply(preview.token, ['preference:uiTheme']);
    a.preferences.setFollowing('display', true);
    assert.equal(a.preferences.snapshot().values.uiTheme, 'future-paper');
    assert.equal(projectPreferences(a.db.state)[key].deviceId, 'reader');
  } finally {
    a.backup.dispose(); b.backup.dispose(); a.db.close(); b.db.close();
  }
});
