import assert from 'node:assert/strict';
import test from 'node:test';
import { DesktopDatabase } from '../src/main/database';
import { SyncRepository } from '../src/main/sync-repository';
import { SyncEngine, type SyncDrive } from '../src/main/sync-engine';
import type { DriveFile } from '../src/main/drive-client';
import type { StateFragment } from '../src/shared/sync';

for (const deleted of [false, true]) test(`duplicate state convergence retains the latest unmodeled setting (tombstone=${deleted})`, async () => {
  const db = DesktopDatabase.open(':memory:');
  db.meta.put('deviceId', 'self');
  const repository = new SyncRepository(db);
  repository.saveConfig({connected: true});
  const files = new Map<string, {file: DriveFile; body: StateFragment}>();
  for (const [id, value, updatedAt] of [['a', 'dark', 1], ['z', 'light', 2]] as const) {
    files.set(id, {file: {id, name: 'state-self.json', appProperties: {app: 'polyask', kind: 'state', schema: '1', id: 'self'}},
      body: {schema: 1, deviceId: 'self', settings: {amsTheme: {value, updatedAt, deviceId: 'self',
        ...(deleted && id === 'z' ? { deletedAt: 2 } : {})}}, templates: {}, groups: {}}});
  }
  const drive: SyncDrive = {
    listFiles: async () => [...files.values()].map(value => value.file),
    getStartToken: async () => '0',
    listChanges: async () => ({changes: [], newStartPageToken: '1'}),
    download: async id => structuredClone(files.get(id)!.body),
    remove: async id => { files.delete(id); },
    upsert: async (id, name, appProperties, body) => {
      const file = {id: id ?? 'new', name, appProperties};
      files.set(file.id, {file, body: structuredClone(body) as StateFragment}); return file;
    },
    clearAll: async () => undefined
  };
  const engine = new SyncEngine({repository, drive, auth: {configured: () => true, securePersistence: () => true,
    connect: async () => undefined, disconnect: async () => undefined}});
  try {
    const result = await engine.syncNow();
    assert.equal(result.state, 'idle'); assert.equal(result.pending, 0);
    assert.equal(files.size, 1);
    assert.equal(files.get('a')?.body.settings.amsTheme.value, 'light',
      'convergence must copy the merged winner before removing the newer duplicate');
    assert.equal(files.get('a')?.body.settings.amsTheme.deletedAt, deleted ? 2 : undefined);
    assert.equal(files.get('a')?.body.deviceId, 'self');
  } finally {engine.dispose(); db.close();}
});

test('duplicate own fragments preserve terminal draft deletion even with draft sync disabled', () => {
  const db = DesktopDatabase.open(':memory:');
  db.meta.put('deviceId', 'self');
  const repository = new SyncRepository(db);
  const payload = { format: 1, id: 'draft-a', kind: 'prompt', context: 'prompt', title: '', content: null };
  const fragment = (removed: boolean): StateFragment => ({ schema: 1, deviceId: 'self', templates: {}, groups: {},
    settings: { 'polyask.draft.draft-a': { value: removed ? payload : { ...payload, content: { text: 'late live copy' } },
      deviceId: 'self', updatedAt: removed ? 20 : 30, ...(removed ? { deletedAt: 20 } : {}) } } });
  try {
    db.meta.put('remoteStates', { a: fragment(true), z: fragment(false) });
    assert.equal(repository.localStateFragment().settings['polyask.draft.draft-a'].deletedAt, 20);
  } finally { db.close(); }
});
