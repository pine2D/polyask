import assert from 'node:assert/strict';
import test from 'node:test';
import { DesktopDatabase } from '../src/main/database';
import { PreferencesRepository } from '../src/main/preferences-repository';
import { DraftRepository } from '../src/main/draft-repository';
import { SyncRepository } from '../src/main/sync-repository';
import { SyncEngine, type SyncDrive } from '../src/main/sync-engine';
import type { DriveFile } from '../src/main/drive-client';

function device(id: string) {
  const db = DesktopDatabase.open(':memory:'); db.meta.put('deviceId', id);
  return { db, preferences: new PreferencesRepository(db.state, db.meta, { now: () => 100 }),
    drafts: new DraftRepository(db.state, db.meta, { now: () => 100 }), sync: new SyncRepository(db) };
}

test('independent preference keys sync without changing local display overrides or open pages', () => {
  const a = device('a'), b = device('b');
  try {
    a.preferences.set('completionNotifications', true);
    a.preferences.setFollowing('display', true); a.preferences.set('density', 'compact');
    a.preferences.set('siteScale', 1);
    b.preferences.seed({ display: { density: 'comfortable', siteScale: 0.9 } });
    assert.equal(b.sync.applyStateFragments({ a: a.sync.localStateFragment() }).changed, true);
    assert.equal(b.preferences.snapshot().values.completionNotifications, true);
    assert.equal(b.preferences.snapshot().values.display.density, 'comfortable');
    b.preferences.setFollowing('display', true);
    assert.equal(b.preferences.snapshot().values.display.density, 'compact');
    assert.equal(b.preferences.snapshot().values.display.siteScale, 1);
    assert.equal(b.preferences.snapshot().initialized.includes('completionNotifications'), true);
    b.preferences.seed({ completionNotifications: false });
    assert.equal(b.preferences.snapshot().values.completionNotifications, true);
  } finally { a.db.close(); b.db.close(); }
});

test('draft sync opt-in keeps concurrent device branches and deletions independent', () => {
  const a = device('a'), b = device('b');
  try {
    a.drafts.setSyncEnabled(true); b.drafts.setSyncEnabled(true);
    const first = a.drafts.save({ kind: 'prompt', context: 'composer', title: 'A', content: { text: 'one' } });
    const second = b.drafts.save({ kind: 'prompt', context: 'composer', title: 'B', content: { text: 'two' } });
    b.sync.applyStateFragments({ a: a.sync.localStateFragment() });
    a.sync.applyStateFragments({ b: b.sync.localStateFragment() });
    assert.equal(a.drafts.list('prompt', 'composer').length, 2);
    assert.equal(b.drafts.list('prompt', 'composer').length, 2);
    a.drafts.remove(first.id, first.updatedAt, 0);
    b.sync.applyStateFragments({ a: a.sync.localStateFragment() });
    assert.deepEqual(b.drafts.list().map(d => d.id), [second.id]);
    a.drafts.setSyncEnabled(false);
    const fragment = a.sync.localStateFragment();
    assert.equal(Object.keys(fragment.settings).some(k => k.startsWith('polyask.draft.')), false);
  } finally { a.db.close(); b.db.close(); }
});

test('real SyncEngine transfers independent preferences and opted-in drafts through Drive files', async () => {
  const cloud = new Map<string, { file: DriveFile; body: unknown }>();
  const drive: SyncDrive = {
    getStartToken: async () => 'token', listFiles: async () => [...cloud.values()].map(v => v.file),
    listChanges: async () => ({ changes: [...cloud.values()].map(v => ({ fileId: v.file.id, file: v.file })), newStartPageToken: 'token' }),
    download: async id => structuredClone(cloud.get(id)!.body),
    upsert: async (id, name, appProperties, body) => {
      const file = { id: id ?? name, name, appProperties }; cloud.set(file.id, { file, body: structuredClone(body) }); return file;
    }, clearAll: async () => { cloud.clear(); }
  };
  const a = device('a'), b = device('b');
  const engine = (d: ReturnType<typeof device>) => {
    d.sync.saveConfig({ connected: true });
    return new SyncEngine({ repository: d.sync, drive, now: () => 1000,
      auth: { configured: () => true, securePersistence: () => true, connect: async () => {}, disconnect: async () => {} } });
  };
  const ea = engine(a), eb = engine(b);
  try {
    a.preferences.set('completionNotifications', true); a.preferences.set('workbenchGuide', { version: 1, disposition: 'completed' });
    a.drafts.setSyncEnabled(true);
    a.drafts.save({ kind: 'prompt', context: 'composer', title: 'unsent', content: { text: 'independent text' } });
    assert.equal((await ea.syncNow()).state, 'idle');
    assert.equal((await eb.syncNow()).state, 'idle');
    assert.equal(b.preferences.snapshot().values.completionNotifications, true);
    assert.equal(b.preferences.snapshot().values.workbenchGuide?.disposition, 'completed');
    assert.equal(b.drafts.list().length, 0, 'draft opt-in controls downloads as well as new uploads');
    b.drafts.setSyncEnabled(true);
    assert.equal((await eb.syncNow()).state, 'idle');
    assert.equal(b.drafts.list()[0]?.content && (b.drafts.list()[0].content as { text: string }).text, 'independent text');
    b.preferences.set('completionNotifications', false);
    assert.equal((await eb.syncNow()).state, 'idle');
    assert.equal((await ea.syncNow()).state, 'idle');
    assert.equal(a.preferences.snapshot().values.completionNotifications, false);
    assert.equal(a.drafts.list().length, 1);
  } finally { ea.dispose(); eb.dispose(); a.db.close(); b.db.close(); }
});
