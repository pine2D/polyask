import assert from 'node:assert/strict';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { transformSync } from 'esbuild';
import { createHash } from 'node:crypto';
import { DesktopDatabase } from '../src/main/database';
import { SyncPull } from '../src/main/sync-pull';
import { SyncRepository } from '../src/main/sync-repository';
import { BackupService } from '../src/main/backup-service';
import { uploadSyncOperation } from '../src/main/sync-upload';
import { readSource } from './fixtures';
import * as sync from '../src/shared/sync';
function frozen(name: string, require: (name: string) => any): any {
  const module = { exports: {} };
  runInNewContext(transformSync(readSource(`test/fixtures/${name}`), { loader: 'ts', format: 'cjs' }).code,
    { module, exports: module.exports, require, Buffer });
  return module.exports;
}
for (const kind of ['question', 'decision']) test(`schema7 ${kind} imports; the frozen schema6 reader blocks before download`, async () => {
  const fixture = JSON.parse(readSource(`test/fixtures/schema7-${kind}-starred.json`));
  const Old = frozen('schema6-sync-pull.ts.txt', name => {
    if (name === 'node:crypto') return { createHash };
    if (name === '../shared/sync') return { ...sync, SUPPORTED_SYNC_SCHEMA: 6 };
    if (name === './sync-duplicates') return { convergeDuplicateFiles: async () => {} };
    if (name === './sync-images') return { SyncImages: class {} };
    throw Error(`unexpected dependency ${name}`);
  });
  for (const old of [false, true]) {
    const db = DesktopDatabase.open(':memory:'), repository = new SyncRepository(db);
    db.meta.put('deviceId', 'fixture');
    let downloads = 0;
    try {
      const Reader = old ? Old.SyncPull : SyncPull;
      await new Reader(repository, { listFiles: async () => [fixture.file], getStartToken: async () => 'start',
        listChanges: async () => ({ changes: [], newStartPageToken: 'next' }),
        download: async () => { downloads++; return fixture.body; } }, () => 100).run(new AbortController().signal);
      assert.equal(repository.config().readOnly, old);
      assert.equal(downloads, old ? 0 : 1);
      if (!old) assert.deepEqual(kind === 'question' ? repository.question(fixture.body.id) : repository.decision(fixture.body.id), fixture.body);
    } finally { db.close(); }
  }
});

test('backup6 is accepted now and explicitly rejected by the frozen backup5 validator', () => {
  const fixture = JSON.parse(readSource('test/fixtures/backup-format6-stars.json'));
  const old = frozen('backup5-validation.ts.txt', createRequire(join(__dirname, '../src/main/backup-validation.ts')));
  assert.throws(() => old.validateBackup(fixture), /backup_version/);
  // Positive control proves the frozen validator can still read its own format.
  assert.equal(old.validateBackup(JSON.parse(readSource('test/fixtures/backup-format5.json'))).version, 5);
  const db = DesktopDatabase.open(':memory:'), backup = new BackupService(db, { deviceId: () => 'local', now: () => 100 });
  try {
    const preview = backup.preview(fixture); backup.apply(preview.token, preview.items.map(item => item.key));
    assert.equal(db.questions.search({ favorite: true }).items[0].id, 'starred-question');
  } finally { backup.dispose(); db.close(); }
});

test('star uploads retain the field in the body and advertise schema7 without adding it to Drive metadata', async () => {
  const db = DesktopDatabase.open(':memory:'); db.meta.put('deviceId', 'fixture');
  const repository = new SyncRepository(db);
  try {
    for (const kind of ['question', 'decision']) {
      const fixture = JSON.parse(readSource(`test/fixtures/schema7-${kind}-starred.json`));
      if (kind === 'question') db.questions.put(fixture.body); else db.decisions.put(fixture.body);
      const operation = db.outbox.ready(100).find(item => item.kind === kind)!;
      let uploaded = false;
      await uploadSyncOperation(repository, { upsert: async (_id: unknown, _name: unknown, properties: any, body: any) => {
        uploaded = true; assert.equal(properties.schema, '7'); assert.equal('favorite' in properties, false);
        assert.deepEqual(body, fixture.body); return { id: `upload-${kind}`, appProperties: properties };
      } } as any, () => 100, { ...operation, revision: operation.revision! }, new AbortController().signal);
      assert.equal(uploaded, true);
    }
  } finally { db.close(); }
});
