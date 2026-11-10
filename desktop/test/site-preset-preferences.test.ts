import assert from 'node:assert/strict';
import test from 'node:test';
import { readSource } from './fixtures';
import { SITE_KEYS } from '../src/shared/contracts';
import { isPreferenceValue, type PreferenceKey } from '../src/shared/preferences';
import { normalizeTierPresetResult } from '../src/shared/tier-presets';
import { DesktopDatabase } from '../src/main/database';
import { PreferencesRepository } from '../src/main/preferences-repository';
import { BackupService } from '../src/main/backup-service';
import { applyPreferences, projectPreferences } from '../src/main/sync-preferences';
import { captureTierPresets } from '../src/main/tier-preset-routing';

const keys = SITE_KEYS.flatMap(site => ['fast', 'think'].map(mode => `${site}${mode === 'fast' ? 'Fast' : 'Think'}Preset` as PreferenceKey));
const pair = (index: number) => ({ model: `Exact choice ${index}`, effort: index % 2 ? 'Extra' : null });

test('all eighteen preset keys persist independently, survive sync/backup, and reset locally', () => {
  const db = DesktopDatabase.open(':memory:'); db.meta.put('deviceId', 'local');
  const prefs = new PreferencesRepository(db.state, db.meta, { now: () => 100 });
  try {
    for (const [i, key] of keys.entries()) {
      assert.equal(isPreferenceValue(key, pair(i)), true, key);
      assert.equal(Reflect.get(prefs.snapshot().values, key), null, key);
      prefs.set(key, pair(i));
    }
    db.resetLocalData();
    const fragment = JSON.parse(readSource('test/fixtures/schema1-state-site-presets.json'));
    assert.equal(applyPreferences(db.state, fragment.body.settings), true);
    const projected = projectPreferences(db.state);
    assert.equal(Object.keys(projected).length, 18);
    keys.forEach((key, i) => assert.deepEqual(projected[`polyask.preference.${key}`].value, pair(i)));
    const key = 'kimiThinkPreset';
    assert.equal(applyPreferences(db.state, { [`polyask.preference.${key}`]: { value: null, updatedAt: 200, deviceId: 'remote' } }), true);
    assert.equal(Reflect.get(prefs.snapshot().values, key), null);
    assert.deepEqual(Reflect.get(prefs.snapshot().values, 'kimiFastPreset'), pair(12));
    const backup = new BackupService(db, { deviceId: () => 'local', now: () => 300 }), exported = backup.export();
    const entries = exported.entries.filter(entry => entry.kind === 'preference');
    assert.equal(entries.length, 18);
    db.resetLocalData();
    keys.forEach(key => assert.equal(Reflect.get(prefs.snapshot().values, key), null, key));
    const preview = backup.preview(exported); backup.apply(preview.token, entries.map(entry => `preference:${entry.id}`));
    keys.forEach((name, i) => assert.deepEqual(Reflect.get(prefs.snapshot().values, name), name === key ? null : pair(i)));
  } finally { db.close(); }
});

test('operation snapshots include every site and isolate later edits and returned objects', () => {
  const values = Object.fromEntries(keys.map((key, i) => [key, pair(i)])), snapshot = captureTierPresets(values);
  for (const [i, site] of SITE_KEYS.entries()) {
    Object.assign(values[keys[i * 2]], { model: 'Later change' });
    assert.deepEqual(snapshot(site, 'fast'), pair(i * 2));
    assert.deepEqual(snapshot(site, 'think'), pair(i * 2 + 1));
    Object.assign(snapshot(site, 'think')!, { effort: 'Max' });
    assert.deepEqual(snapshot(site, 'think'), pair(i * 2 + 1));
    assert.equal(snapshot(site, null), undefined);
  }
});

test('catalog semantics distinguish models, modes and toggles and reject unknown metadata', () => {
  const current = { model: 'DeepThink', effort: 'Off' };
  const catalog = { models: ['DeepThink'], model: 'DeepThink', efforts: ['Off', 'On'], current, primary: 'feature', secondary: 'toggle' };
  const result = normalizeTierPresetResult({ ok: true, current, catalog });
  assert.deepEqual(result, { ok: true, current, catalog });
  for (const field of ['primary', 'secondary']) {
    assert.deepEqual(normalizeTierPresetResult({ ok: true, current, catalog: { ...catalog, [field]: 'guess' } }), { ok: false, code: 'invalid_response' });
  }
});
