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
import { readSource } from './fixtures';
import * as syncTypes from '../src/shared/sync';
const localRequire = createRequire(join(__dirname, '../src/main/backup-validation.ts'));
function frozen(name: string, require: (name: string) => any): any {
  const module = { exports: {} };
  runInNewContext(transformSync(readSource(`test/fixtures/${name}`), { loader: 'ts', format: 'cjs' }).code,
    { module, exports: module.exports, require, Buffer });
  return module.exports;
}
for (const name of ['schema6-questionAnswer.json', 'schema6-archive.json']) {
  test(`frozen ${name} imports through the new reader`, async () => {
    const fixture = JSON.parse(readSource(`test/fixtures/${name}`));
    const db = DesktopDatabase.open(':memory:'), repo = new SyncRepository(db); db.meta.put('deviceId', 'fixture');
    try {
      await new SyncPull(repo, { listFiles: async () => [fixture.file], getStartToken: async () => 'start',
        listChanges: async () => ({ changes: [], newStartPageToken: 'next' }), download: async () => fixture.body }, () => 100).run(new AbortController().signal);
      assert.equal(repo.config().readOnly, false); assert.equal(repo.config().errorCount, 0);
      const actual = fixture.file.appProperties.kind === 'archive' ? repo.archive(fixture.body.id) : repo.questionAnswer(fixture.body.id);
      assert.deepEqual(actual, fixture.body);
    } finally { db.close(); }
  });
  test(`actual frozen schema5 reader locks before downloading ${name}`, async () => {
    const Old = frozen('schema5-sync-pull.ts.txt', name => {
      if (name === 'node:crypto') return { createHash };
      if (name === '../shared/sync') return { ...syncTypes, SUPPORTED_SYNC_SCHEMA: 5 };
      if (name === './sync-duplicates') return { convergeDuplicateFiles: async () => { throw Error('must_not_delete'); } };
      if (name === './sync-images') return { SyncImages: class {} };
      throw Error(`unexpected dependency ${name}`);
    });
    const fixture = JSON.parse(readSource(`test/fixtures/${name}`));
    const db = DesktopDatabase.open(':memory:'), repo = new SyncRepository(db); db.meta.put('deviceId', 'fixture');
    try {
      await new Old.SyncPull(repo, { listFiles: async () => [fixture.file], getStartToken: async () => 'start',
        listChanges: async () => ({ changes: [], newStartPageToken: 'next' }), download: async () => { throw Error('must_not_download'); } }, () => 100).run(new AbortController().signal);
      assert.equal(repo.config().readOnly, true);
      assert.equal(repo.config().futureFiles?.[fixture.file.id], 6);
    } finally { db.close(); }
  });
}
test('frozen backup5 restores through current reader and actual backup4 validator rejects it', () => {
  const fixture = JSON.parse(readSource('test/fixtures/backup-format5.json'));
  const db = DesktopDatabase.open(':memory:');
  const service = new BackupService(db, { deviceId: () => 'local', now: () => 100 });
  try {
    const preview = service.preview(fixture);
    assert.equal(service.apply(preview.token, preview.items.map(item => item.key)).imported, 3);
    const old = frozen('backup4-validation.ts.txt', localRequire);
    assert.throws(() => old.validateBackup(fixture), /backup_version/);
  } finally { service.dispose(); db.close(); }
});
