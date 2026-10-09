import assert from 'node:assert/strict';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { DesktopDatabase } from '../src/main/database';
import { DraftRepository } from '../src/main/draft-repository';
import { PreferenceRuntime } from '../src/main/preference-runtime';
import { PreferencesRepository } from '../src/main/preferences-repository';
import type { ViewManager } from '../src/main/view-manager';
import type { DisplayPreferences } from '../src/shared/display';
import { readSource } from './fixtures';

test('cold-start display cache cannot overwrite the accepted shared display selection', async () => {
  const database = DesktopDatabase.open(':memory:');
  database.meta.put('deviceId', 'local');
  const repository = new PreferencesRepository(database.state, database.meta, { now: () => 300 });
  database.state.put('preference:density', { value: 'comfortable', updatedAt: 200, deviceId: 'remote' }, 200, false);
  database.state.put('preference:siteScale', { value: 1, updatedAt: 200, deviceId: 'remote' }, 200, false);
  repository.setFollowing('display', true);
  const manager = {
    getUiState: () => ({ maximized: false, layoutMode: 'overview', currentPage: 0, focusedByPage: {}, siteZoom: {} }),
    getLayout: () => ({ focused: 'kimi' }), setLayout: () => true,
    siteZoom: { restore: () => {} }
  } as unknown as ViewManager;
  const runtime = new PreferenceRuntime(repository, new DraftRepository(database.state, database.meta),
    manager, () => {}, () => {}, () => {});
  try {
    const source = readSource('src/renderer/index.tsx');
    const start = source.indexOf('if (!bootstrapStarted.current)');
    const end = source.indexOf('const offStatus', start);
    assert.equal(start >= 0 && end > start, true, 'execute the production startup block');
    runInNewContext(source.slice(start, end), {
      bootstrapStarted: { current: false }, bootstrap: async () => {},
      INITIAL_DISPLAY: { density: 'compact', siteScale: 0.9 },
      display: { save: async (value: DisplayPreferences) => runtime.setDisplay(value) },
      copy: { displayPreferencesFailed: 'failed' }, setAnnouncement: () => {}
    });
    await Promise.resolve();
    assert.equal(runtime.snapshot().values.display.density, 'comfortable');
    assert.equal(runtime.snapshot().values.display.siteScale, 1);
    assert.equal(runtime.snapshot().versions.density?.updatedAt, 200);
    assert.equal(database.outbox.count(), 0);
  } finally { database.close(); }
});
