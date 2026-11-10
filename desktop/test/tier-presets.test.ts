import assert from 'node:assert/strict';
import test from 'node:test';
import { readSource } from './fixtures';
import { normalizeTierPresetResult } from '../src/shared/tier-presets';
import { DesktopDatabase } from '../src/main/database';
import { PreferencesRepository } from '../src/main/preferences-repository';
import { BackupService } from '../src/main/backup-service';
import { applyPreferences, projectPreferences } from '../src/main/sync-preferences';
import { isPreferenceValue, type PreferenceKey } from '../src/shared/preferences';

const fast = 'claudeFastPreset' as PreferenceKey;
const think = 'claudeThinkPreset' as PreferenceKey;
const extra = { model: 'Fable 5.2', effort: 'Extra' };
const max = { model: 'Opus 5.5', effort: 'Max' };
function open() {
  const db = DesktopDatabase.open(':memory:');
  db.meta.put('deviceId', 'local');
  return { db, prefs: new PreferencesRepository(db.state, db.meta, { now: () => 100 }) };
}

test('preset values preserve exact model and effort with strict bounded fields', () => {
  for (const value of [null, extra, max, { model: 'Haiku 5.5', effort: null }]) {
    assert.equal(isPreferenceValue(fast, value), true);
    assert.equal(isPreferenceValue(think, value), true);
  }
  for (const value of [false, [], {}, { ...extra, extra: true }, { ...extra, effort: '' },
    { ...extra, model: 'x'.repeat(49) }, { ...extra, effort: 'x'.repeat(25) },
    { ...extra, model: ' Fable 5.2' }, { ...extra, model: 'Fable\n5.2' },
    { ...extra, model: '<script>alert(1)</script>' }, { model: 'Fable 5.2' }]) {
    assert.equal(isPreferenceValue(think, value), false);
  }
});

test('independent presets sync exact pairs, and reset to default is a versioned null', () => {
  const { db, prefs } = open();
  try {
    assert.equal(Reflect.get(prefs.snapshot().values, fast), null);
    assert.equal(db.outbox.count(), 0);
    prefs.set(fast, max); prefs.set(think, extra);
    const settings = projectPreferences(db.state);
    assert.deepEqual(settings['polyask.preference.claudeFastPreset'].value, max);
    assert.deepEqual(settings['polyask.preference.claudeThinkPreset'].value, extra);
    assert.equal(applyPreferences(db.state, {
      'polyask.preference.claudeThinkPreset': { value: null, updatedAt: 200, deviceId: 'remote' }
    }), true);
    assert.deepEqual(Reflect.get(prefs.snapshot().values, fast), max);
    assert.equal(Reflect.get(prefs.snapshot().values, think), null);
    prefs.set(think, extra); prefs.set(think, null);
    assert.equal(projectPreferences(db.state)['polyask.preference.claudeThinkPreset'].value, null);
    assert.equal(db.state.entries('preference:claude').length, 2);
  } finally { db.close(); }
});

test('new wire fixture round-trips through sync, backup and local reset', () => {
  const { db, prefs } = open();
  try {
    const fragment = JSON.parse(readSource('test/fixtures/schema1-state-claude-presets.json'));
    assert.equal(applyPreferences(db.state, fragment.body.settings), true);
    assert.deepEqual(Reflect.get(prefs.snapshot().values, think), extra);
    const backup = new BackupService(db, { deviceId: () => 'local', now: () => 300 });
    const exported = backup.export();
    const presetEntries = exported.entries.filter(value => value.kind === 'preference');
    assert.deepEqual(presetEntries.map(value => value.id).sort(), ['claudeFastPreset', 'claudeThinkPreset']);
    db.resetLocalData();
    assert.equal(Reflect.get(prefs.snapshot().values, think), null);
    assert.equal(db.outbox.count(), 0);
    const preview = backup.preview(exported);
    backup.apply(preview.token, presetEntries.map(value => `preference:${value.id}`));
    assert.deepEqual(Reflect.get(prefs.snapshot().values, think), extra);
    assert.deepEqual(Reflect.get(prefs.snapshot().values, fast), max);
  } finally { db.close(); }
});


test('page results are bounded, detached and cannot mix catalog and current selection', () => {
  const catalog = { models: ['Fable 5.2'], model: 'Fable 5.2', efforts: ['Extra', 'Max'], current: extra };
  const input = { ok: true, current: extra, catalog };
  assert.equal(normalizeTierPresetResult(input).ok, true);
  for (const value of [{ ...input, catalog: { ...catalog, models: Array(51).fill('Fable 5.2') } },
    { ...input, catalog: { ...catalog, efforts: ['Extra', 'Extra'] } },
    { ...input, catalog: { ...catalog, current: max } }, { ok: false, code: 'arbitrary page content' }]) {
    assert.deepEqual(normalizeTierPresetResult(value), { ok: false, code: 'invalid_response' });
  }
  const result = normalizeTierPresetResult(input);
  catalog.efforts.push('Future');
  assert.equal(result.ok && result.catalog?.efforts.length, 2);
});
