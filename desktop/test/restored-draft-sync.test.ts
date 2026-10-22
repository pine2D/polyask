import assert from 'node:assert/strict';
import test from 'node:test';
import { DesktopDatabase } from '../src/main/database';
import { BackupService } from '../src/main/backup-service';
import { SyncRepository } from '../src/main/sync-repository';
import { DraftRepository } from '../src/main/draft-repository';
import { SyncEngine, type SyncDrive } from '../src/main/sync-engine';
import type { DriveFile } from '../src/main/drive-client';

test('a restored independent draft reaches a second device when draft sync is enabled', async () => {
  const source = DesktopDatabase.open(':memory:');
  const target = DesktopDatabase.open(':memory:');
  const remote = new Map<string, {file: DriveFile; body: unknown}>();
  const drive: SyncDrive = {
    listFiles: async () => [...remote.values()].map(value => value.file),
    getStartToken: async () => '0',
    listChanges: async () => ({changes: [...remote.values()].map(({ file }) => ({ fileId: file.id, file })), newStartPageToken: '1'}),
    download: async id => remote.get(id)!.body,
    upsert: async (id, name, appProperties, body) => {
      const file = {id: id ?? `file-${remote.size}`, name, appProperties};
      remote.set(file.id, {file, body: structuredClone(body)}); return file;
    },
    clearAll: async () => undefined
  };
  const auth = {configured: () => true, securePersistence: () => true, connect: async () => undefined, disconnect: async () => undefined};
  source.meta.put('deviceId', 'source'); target.meta.put('deviceId', 'target');
  source.meta.put('draftSyncEnabled', true); target.meta.put('draftSyncEnabled', true);
  const sourceRepo = new SyncRepository(source), targetRepo = new SyncRepository(target);
  sourceRepo.saveConfig({connected: true}); targetRepo.saveConfig({connected: true});
  const sender = new SyncEngine({repository: sourceRepo, drive, auth});
  const receiver = new SyncEngine({repository: targetRepo, drive, auth});
  const backup = new BackupService(source, {deviceId: () => 'source', now: () => 100});
  try {
    const preview = backup.preview({format: 'polyask-backup', version: 3, exportedAt: 20, entries: [{
      kind: 'draft', id: 'original', body: {format: 1, id: 'original', kind: 'prompt', context: 'prompt',
        title: 'Saved prompt', content: {text: 'preserved draft'}, updatedAt: 10}
    }]});
    assert.equal(backup.apply(preview.token, ['draft:original']).imported, 1);
    assert.equal(source.state.entries('draft:').length, 1);
    const sent = await sender.syncNow();
    assert.equal(sent.pending, 0);
    assert.equal(sent.state, 'idle');
    await receiver.syncNow();
    assert.equal(new DraftRepository(target.state, target.meta).list('prompt', 'prompt').length, 1,
      'successfully synced restored draft must be recoverable on the other device');
    const localDrafts = new DraftRepository(source.state, source.meta), otherDrafts = new DraftRepository(target.state, target.meta);
    const restored = otherDrafts.list('prompt', 'prompt')[0];
    assert.equal(restored.deviceId, `backup:${restored.id}`);
    assert.equal(otherDrafts.removeOwn('prompt', 'prompt'), false, 'restored work remains separate from the editor branch');
    localDrafts.save({ kind: 'prompt', context: 'prompt', title: 'New work', content: { text: 'new local work' } });
    assert.equal(localDrafts.list('prompt', 'prompt').length, 2);
    assert.equal(otherDrafts.remove(restored.id), true);
    await receiver.syncNow(); await sender.syncNow(); await receiver.syncNow();
    assert.equal(localDrafts.get(restored.id)?.deletedAt !== undefined, true, 'remote deletion tombstones the restored branch');
    assert.equal(otherDrafts.list('prompt', 'prompt').some(draft => draft.id === restored.id), false);
    assert.equal(localDrafts.list('prompt', 'prompt').length, 1, 'the independent local draft survives');
  } finally {sender.dispose(); receiver.dispose(); backup.dispose(); source.close(); target.close();}
});
