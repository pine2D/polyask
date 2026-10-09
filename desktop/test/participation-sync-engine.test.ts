import assert from 'node:assert/strict';
import test from 'node:test';
import { DesktopDatabase } from '../src/main/database';
import { SyncEngine, type SyncDrive } from '../src/main/sync-engine';
import { SyncRepository } from '../src/main/sync-repository';
import { WorkspaceService } from '../src/main/workspace-service';
import type { DriveFile } from '../src/main/drive-client';

test('real sync engine uploads exclusions and a second device publishes remote changes', async () => {
  const cloud = new Map<string, { file: DriveFile; body: unknown }>();
  const drive: SyncDrive = {
    getStartToken: async () => 'token',
    listFiles: async () => [...cloud.values()].map(entry => entry.file),
    listChanges: async () => ({ changes: [...cloud.values()].map(entry => ({ fileId: entry.file.id, file: entry.file })), newStartPageToken: 'token' }),
    download: async id => structuredClone(cloud.get(id)!.body),
    upsert: async (id, name, appProperties, body) => {
      const file = { id: id ?? name, name, appProperties };
      cloud.set(file.id, { file, body: structuredClone(body) }); return file;
    },
    clearAll: async () => { cloud.clear(); }
  };
  const device = (id: string) => {
    const database = DesktopDatabase.open(':memory:'); database.meta.put('deviceId', id);
    const workspace = new WorkspaceService(database.state, database.meta, () => {}, { now: () => 100 });
    const repository = new SyncRepository(database); repository.saveConfig({ connected: true });
    let publications = 0;
    const engine = new SyncEngine({ repository, drive, now: () => 1000,
      onWorkspaceChanged: () => { publications++; },
      auth: { configured: () => true, securePersistence: () => true, connect: async () => {}, disconnect: async () => {} } });
    return { database, workspace, repository, engine, publications: () => publications };
  };
  const a = device('a'), b = device('b');
  try {
    a.workspace.setSelection(['claude', 'kimi']); a.workspace.setParticipation(['kimi']);
    assert.equal((await a.engine.syncNow()).state, 'idle');
    assert.equal(a.repository.pending(), 0);
    assert.equal((await b.engine.syncNow()).state, 'idle');
    assert.deepEqual(b.workspace.getState().participatingSites, ['kimi']);
    assert.equal(b.publications() > 0, true);
    b.workspace.setParticipation([]);
    assert.equal((await b.engine.syncNow()).state, 'idle');
    assert.equal((await a.engine.syncNow()).state, 'idle');
    assert.deepEqual(a.workspace.getState().participatingSites, []);
    assert.deepEqual(a.workspace.getState().selectedSites, ['claude', 'kimi']);
    assert.equal(a.repository.pending(), 0);
    assert.equal(b.repository.pending(), 0);
  } finally { a.engine.dispose(); b.engine.dispose(); a.database.close(); b.database.close(); }
});
