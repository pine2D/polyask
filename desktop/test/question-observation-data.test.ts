import MarkdownIt from 'markdown-it';
import assert from 'node:assert/strict';
import test from 'node:test';
import { DesktopDatabase } from '../src/main/database';
import { BackupService } from '../src/main/backup-service';
import { validateBackup } from '../src/main/backup-validation';
import { SyncRepository } from '../src/main/sync-repository';
import { SyncPull } from '../src/main/sync-pull';
import { createHash } from 'node:crypto';
import { projectQuestionArchiveInput } from '../src/shared/question-archive';
import { createArchiveRecord, isArchiveRecord } from '../src/shared/archive';
import { SITES } from '../src/main/sites';
import { renderReportHtml } from '../src/main/report-template';
import { questionAnswerFixture, questionFixture } from './question-fixtures';
const observation = { questionId: 'q-a', site: 'claude' as const, attempt: 1, observedAt: 10,
  selection: { requested: 'think' as const, outcome: 'preferred' as const, observed: 'think' as const, model: 'Example <Pro>' } };
const answer = () => ({ ...questionAnswerFixture(), schema: 6 as const, observation });
const archive = () => createArchiveRecord(projectQuestionArchiveInput(questionFixture(), [answer()], SITES, 'en'), { id: 'archive', now: 20, deviceId: 'local' });
test('history conversion preserves structured provenance outside original answer and bounded label', () => {
  const record = archive();
  assert.equal(record.schema, 6);
  assert.deepEqual((record.results[0] as any).observation, observation);
  assert.equal(record.results[0].text, 'Saved answer');
  assert.equal([...record.results[0].label].length <= 256, true);
  assert.equal(record.results[0].label.includes('Example'), false);
  assert.equal(isArchiveRecord(record), true);
  assert.equal(isArchiveRecord({ ...record, schema: 1 }), false);
  const html = renderReportHtml({ kind: 'archive', archive: record });
  assert.equal(html.includes('Example &lt;Pro&gt;'), true);
  assert.equal(html.includes('Webpage observation'), true);
});
test('schema6 answer and archive round-trip through production pull, reset and tombstones', async () => {
  const db = DesktopDatabase.open(':memory:'), repo = new SyncRepository(db);
  db.meta.put('deviceId', 'local');
  const records = [{ kind: 'questionAnswer', body: answer() }, { kind: 'archive', body: archive() }];
  const files = records.map(({ kind, body }, index) => ({ id: `file-${index}`, appProperties: { app: 'polyask', kind, schema: '6',
    id: kind === 'archive' ? body.id : createHash('sha256').update(body.id).digest('hex') } }));
  try {
    db.questions.put(questionFixture());
    await new SyncPull(repo, { listFiles: async () => files, getStartToken: async () => 'start',
      listChanges: async () => ({ changes: [], newStartPageToken: 'next' }),
      download: async id => records[files.findIndex(f => f.id === id)].body }, () => 100).run(new AbortController().signal);
    assert.equal(repo.config().readOnly, false);
    assert.equal(repo.config().errorCount, 0);
    assert.deepEqual((repo.questionAnswer(answer().id) as any)?.observation, observation);
    assert.deepEqual((repo.archive('archive') as any)?.results[0].observation, observation);
    db.questions.delete('q-a', 101, 'local');
    const deleted = repo.questionAnswer(answer().id)!;
    assert.equal('deletedAt' in deleted, true);
    assert.equal(deleted.schema, 6);
    assert.equal('observation' in deleted, false);
    db.resetLocalData();
    assert.equal(repo.questionAnswer(answer().id), null);
    assert.equal(repo.archive('archive'), null);
  } finally { db.close(); }
});
test('backup5 preserves observation and remaps restored answer identity without rewriting independent archive provenance', () => {
  const source = DesktopDatabase.open(':memory:'), target = DesktopDatabase.open(':memory:');
  try {
    source.questions.put(questionFixture()); source.questions.putAnswer(answer()); source.archives.put(archive());
    const backup = new BackupService(source, { deviceId: () => 'source', now: () => 100 }).export();
    assert.equal(backup.version, 5);
    assert.throws(() => validateBackup({ ...backup, version: 3 }), /backup_version/);
    target.questions.put(questionFixture()); target.questions.delete('q-a', 30, 'target');
    const service = new BackupService(target, { deviceId: () => 'target', now: () => 100 });
    const preview = service.preview(backup);
    assert.equal(service.apply(preview.token, preview.items.map(i => i.key)).imported, 3);
    const restored = target.questions.search().items[0];
    assert.notEqual(restored.id, 'q-a');
    const saved = target.questions.answers(restored.id)[0];
    assert.equal((saved as any).observation.questionId, restored.id);
    assert.deepEqual((target.archives.get('archive') as any).results[0].observation, observation);
  } finally { source.close(); target.close(); }
});
test('observation archives can be tombstoned without dropping the schema boundary', () => {
  const db = DesktopDatabase.open(':memory:');
  try {
    db.archives.put(archive());
    db.archives.delete('archive', 100, 'local');
    const deleted = db.archives.get('archive')!;
    assert.equal('deletedAt' in deleted, true);
    assert.equal(deleted.schema, 6);
  } finally { db.close(); }
});
test('Markdown history and archive exports retain observation without changing saved answer text', async () => {
  const { MarkdownSources } = await import('../src/main/markdown-export-source');
  const { getCopy } = await import('../src/shared/copy');
  const db = DesktopDatabase.open(':memory:');
  try {
    db.questions.put(questionFixture()); db.questions.putAnswer(answer()); db.archives.put(archive());
    const sources = new MarkdownSources({ questions: db.questions, archives: { get: () => archive() }, decisions: { get: () => null } });
    for (const locale of ['en', 'zh-CN', 'zh-TW']) {
      const copy = getCopy(locale);
      for (const target of [{ kind: 'history' as const, id: 'q-a' }, { kind: 'archive' as const, id: 'archive' }]) {
        const preview = sources.preview(target, copy);
        const { markdown } = sources.read({ target, revision: preview.revision, entryIds: preview.entries.map(e => e.id) }, copy);
        assert.equal(markdown.includes(copy.observationTitle), true);
        assert.equal(new MarkdownIt().render(markdown).includes(copy.observationNote), true);
        assert.equal(markdown.includes('Example'), true);
        assert.equal(markdown.includes('Saved answer'), true);
      }
    }
    assert.equal(db.questions.answers('q-a')[0].answerMarkdown, 'Saved answer');
  } finally { db.close(); }
});
