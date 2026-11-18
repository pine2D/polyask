import assert from 'node:assert/strict';
import test from 'node:test';
import { DesktopDatabase } from '../src/main/database';
import { SyncPull } from '../src/main/sync-pull';
import { SyncRepository } from '../src/main/sync-repository';
import type { DriveFile } from '../src/main/drive-client';

test('Drive pull distinguishes unreadable versions, corrupt versions, and mismatched envelopes', async () => {
  const files: DriveFile[] = [];
  const add = (id: string, kind: string, schema?: string) => files.push({
    id, appProperties: { app: 'polyask', kind, id, ...(schema === undefined ? {} : { schema }) }
  });
  add('unknown-old', 'unknown', '1');
  add('unknown-new', '__proto__', '2');
  add('state-hole', 'state', '5');
  add('question-missing', 'question');
  add('archive-invalid', 'archive', 'one');
  add('archive-body-hole', 'archive', '1');
  add('archive-body-mismatch', 'archive', '1');
  const downloads: string[] = [];
  const db = DesktopDatabase.open(':memory:');
  db.meta.put('deviceId', 'fixture');
  const repository = new SyncRepository(db);
  try {
    await new SyncPull(repository, {
      listFiles: async () => files,
      getStartToken: async () => 'start',
      listChanges: async () => ({ changes: [], newStartPageToken: 'next' }),
      download: async id => { downloads.push(id); return { schema: id === 'archive-body-hole' ? 5 : 6 }; }
    }, () => 100).run(new AbortController().signal);
    assert.deepEqual(downloads, ['archive-body-hole', 'archive-body-mismatch']);
    assert.deepEqual(repository.config().futureFiles, { 'unknown-new': 2, 'state-hole': 5, 'archive-body-hole': 5 });
    assert.equal(repository.config().readOnly, true);
    assert.equal(repository.config().errorCount, 4);
  } finally { db.close(); }
});
