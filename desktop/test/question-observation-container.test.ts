import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DesktopDatabase } from '../src/main/database';
import { BackupService } from '../src/main/backup-service';
import { readBackupContainer } from '../src/main/backup-container';
import { BACKUP_MAGIC, BACKUP_LEGACY_MAGIC } from '../src/shared/backup';
import { questionAnswerFixture } from './question-fixtures';
import { image, question } from './lib/question-attachment-fixtures';
import { SyncRepository } from '../src/main/sync-repository';
import { uploadSyncOperation } from '../src/main/sync-upload';
import { readSource } from './fixtures';

test('v5 binary backup preserves both originals and attempt observation; v4 cannot carry v5 content', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'polyask-observation-v5-'));
  const source = DesktopDatabase.open(':memory:'), target = DesktopDatabase.open(':memory:');
  const exporter = new BackupService(source, { deviceId: () => 'local' });
  const importer = new BackupService(target, { deviceId: () => 'remote', stagingRoot: dir });
  try {
    const q = question(); source.questions.put(q); source.questionAttachments.save(q, [image()]);
    const a = { ...questionAnswerFixture(), schema: 6 as const, observation: { questionId: q.id, site: 'claude' as const, attempt: 1,
      observedAt: 10, selection: { requested: 'fast' as const, observed: 'fast' as const, outcome: 'mode_only' as const } } };
    source.questions.putAnswer(a);
    const path = join(dir, 'snapshot.polyask'); await exporter.exportFile(path);
    const bytes = await readFile(path);
    assert.equal(bytes.subarray(0, Buffer.byteLength(BACKUP_MAGIC)).toString(), BACKUP_MAGIC);
    const preview = await importer.previewFile(path);
    assert.equal(importer.apply(preview.token, preview.items.map(i => i.key)).imported, 3);
    assert.deepEqual(target.questions.answers(q.id)[0].observation, a.observation);
    assert.deepEqual(target.questionAttachments.readAll(q.id), [image()]);
    const wrong = join(dir, 'wrong.polyask');
    await writeFile(wrong, Buffer.concat([Buffer.from(BACKUP_LEGACY_MAGIC), bytes.subarray(Buffer.byteLength(BACKUP_MAGIC))]));
    await assert.rejects(readBackupContainer(wrong), /backup_version/);
    const textOnly = exporter.export();
    assert.equal(textOnly.version, 5); assert.equal(textOnly.omissions?.[0].questionId, q.id);
    assert.equal(importer.preview(textOnly).items.some(i => i.kind === 'questionAnswer'), true);
  } finally { exporter.dispose(); importer.dispose(); source.close(); target.close(); await rm(dir, { recursive: true, force: true }); }
});
test('schema6 uploads advertise the matching body schema and keep observation out of Drive metadata', async () => {
  const db = DesktopDatabase.open(':memory:'); db.meta.put('deviceId', 'local');
  const repo = new SyncRepository(db);
  try {
    for (const name of ['schema6-questionAnswer.json', 'schema6-archive.json']) {
      const fixture = JSON.parse(readSource(`test/fixtures/${name}`));
      const kind = fixture.file.appProperties.kind;
      if (kind === 'archive') db.archives.put(fixture.body); else db.questions.putAnswer(fixture.body);
      const op = db.outbox.ready(100).find(o => o.kind === kind)!;
      let uploaded = false;
      await uploadSyncOperation(repo, { upsert: async (_id: unknown, _name: unknown, props: any, body: any) => {
        uploaded = true; assert.equal(props.schema, '6'); assert.deepEqual(body, fixture.body);
        assert.equal(JSON.stringify(props).includes('Example Pro'), false);
        return { id: `upload-${kind}`, appProperties: props };
      } } as any, () => 100, { ...op, revision: op.revision! }, new AbortController().signal);
      assert.equal(uploaded, true);
    }
  } finally { db.close(); }
});
