import assert from 'node:assert/strict';
import test from 'node:test';
import { DesktopDatabase } from '../src/main/database';
import { PreferencesRepository } from '../src/main/preferences-repository';
import { DraftRepository } from '../src/main/draft-repository';
import { PreferenceRuntime } from '../src/main/preference-runtime';
import { SyncRepository } from '../src/main/sync-repository';
import { applyDrafts } from '../src/main/sync-drafts';
import type { ViewManager } from '../src/main/view-manager';
import type { SiteZoomPreferences } from '../src/shared/site-zoom';
import type { StateFragment } from '../src/shared/sync';

test('terminal draft deletion survives merging a newer live setting before first import', () => {
  const database = DesktopDatabase.open(':memory:');
  database.meta.put('deviceId', 'new-device'); database.meta.put('draftSyncEnabled', true);
  const sync = new SyncRepository(database), drafts = new DraftRepository(database.state, database.meta);
  const fragment = (deleted: boolean): StateFragment => ({ schema: 1, deviceId: deleted ? 'deleting-device' : 'stale-writer', templates: {}, groups: {}, settings: {
    'polyask.draft.shared-draft': { value: { format: 1, id: 'shared-draft', kind: 'prompt', context: 'composer',
      title: deleted ? '' : 'old branch', content: deleted ? null : { text: 'deleted labor' } },
      deviceId: 'branch-owner', updatedAt: deleted ? 100 : 200, ...(deleted ? { deletedAt: 100 } : {}) }
  } });
  try {
    sync.applyStateFragments({ deletion: fragment(true), stale: fragment(false) });
    assert.equal(drafts.list().length, 0, 'a terminal deletion cannot disappear in generic version merging');
    assert.equal(drafts.get('shared-draft')?.deletedAt, 100);
  } finally { database.close(); }
});

test('runtime reset rejects late legacy seeding from the previous renderer initialization', () => {
  const database = DesktopDatabase.open(':memory:'); database.meta.put('deviceId', 'device-a');
  const repository = new PreferencesRepository(database.state, database.meta, { now: () => 100 });
  let zoom: SiteZoomPreferences = {};
  const manager = { getUiState: () => ({ maximized: false, layoutMode: 'overview', currentPage: 0, focusedByPage: {}, siteZoom: zoom }),
    getLayout: () => ({ focused: 'kimi' }), setLayout: () => true,
    siteZoom: { restore: (next: SiteZoomPreferences) => { zoom = next; } } } as unknown as ViewManager;
  const runtime = new PreferenceRuntime(repository, new DraftRepository(database.state, database.meta), manager, () => {}, () => {}, () => {});
  try {
    // A startup get response may reach the renderer only after an async reset
    // finishes; its old seed request is then a new IPC with obsolete contents.
    database.resetLocalData(); runtime.reset();
    runtime.seed({ completionNotifications: true, workbenchGuide: { version: 1, disposition: 'completed' } });
    assert.equal(repository.snapshot().values.completionNotifications, false);
    assert.equal(repository.snapshot().values.workbenchGuide, null);
    assert.equal(database.outbox.count(), 0);
  } finally { database.close(); }
});

test('older terminal draft deletion wins over a locally newer live branch with matching identity', () => {
  const database = DesktopDatabase.open(':memory:'); database.meta.put('deviceId', 'branch-owner');
  const drafts = new DraftRepository(database.state, database.meta, { now: () => 200, createId: () => 'shared-draft' });
  try {
    drafts.save({ kind: 'prompt', context: 'composer', title: 'local late edit', content: { text: 'deleted labor' } });
    assert.equal(applyDrafts(database.state, { 'polyask.draft.shared-draft': {
      value: { format: 1, id: 'shared-draft', kind: 'prompt', context: 'composer', title: '', content: null },
      updatedAt: 100, deletedAt: 100, deviceId: 'branch-owner'
    } }), true);
    assert.equal(drafts.list().length, 0);
  } finally { database.close(); }
});
