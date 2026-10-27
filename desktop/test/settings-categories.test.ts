import assert from 'node:assert/strict';
import test from 'node:test';
import { SETTINGS_CATEGORIES, resolveSettingsTarget, type SettingsNavigationTarget } from '../src/renderer/settings-categories';

test('seven categories and all existing deep links resolve to explicit destinations', () => {
  assert.deepEqual(SETTINGS_CATEGORIES, ['appearance', 'interaction', 'sync', 'backup', 'network', 'data', 'about']);
  const expected = {
    display: ['appearance', 'settings-display-title'], overview: ['sync', 'sync-title'], connection: ['sync', 'sync-title'],
    'drive-diagnostics': ['sync', 'sync-diagnostics-toggle'], 'image-sync': ['sync', 'question-image-sync-title'],
    'preference-sync': ['sync', 'settings-preference-sync-title'], proxy: ['network', 'settings-proxy-title'],
    data: ['data', 'settings-advanced-toggle'], 'backup-export': ['backup', 'backup-card-title']
  };
  for (const [target, [category, id]] of Object.entries(expected)) {
    assert.deepEqual(resolveSettingsTarget(target as SettingsNavigationTarget), { category, id });
  }
  for (const category of SETTINGS_CATEGORIES) assert.deepEqual(resolveSettingsTarget({ category }), { category, id: `settings-category-${category}` });
  for (const target of [undefined, 'unknown', null, {}, { category: 'unknown' }]) {
    assert.deepEqual(resolveSettingsTarget(target as SettingsNavigationTarget), { category: 'appearance', id: 'settings-category-appearance' });
  }
});
