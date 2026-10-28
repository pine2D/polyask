import assert from 'node:assert/strict';
import test from 'node:test';
import MarkdownIt from 'markdown-it';
import { DesktopDatabase } from '../src/main/database';
import { MarkdownExportService } from '../src/main/markdown-export-service';
import { archiveFixture } from './fixtures';
import { questionFixture, questionAnswerFixture } from './question-fixtures';
function harness(archive = archiveFixture()) {
  const db = DesktopDatabase.open(':memory:'); db.questions.put(questionFixture()); db.questions.putAnswer(questionAnswerFixture());
  db.questions.putAnswer({ ...questionAnswerFixture('q-a', 2), answerMarkdown: null, capturedAt: null, capture: 'waiting', sealedAt: null });
  let path: () => Promise<string | null> = async () => '/tmp/synthetic-export.md'; let text = '', writes = 0;
  const service = new MarkdownExportService({ questions: db.questions, archives: { get: (id: string) => id === 'archive-a' ? archive : null }, decisions: { get: () => null },
    epoch: () => db.questions.lifecycle, isCurrent: () => true, choosePath: () => path(),
    writeFile: async (_path, data, guard) => { guard(); writes++; text = String(data); } });
  const target = { kind: 'history', id: 'q-a' } as const;
  const request = () => ({ selections: [{ target, revision: service.preview({ targets: [target] })[0].revision, entryIds: [questionAnswerFixture().id] }], locale: 'zhCN' as const });
  return { db, service, target, request, saved: () => ({ text, writes }), choose: (fn: typeof path) => { path = fn; } };
}
test('preview exposes attempt availability without sending saved bodies', () => {
  const h = harness(); try {
    const [doc] = h.service.preview({ targets: [h.target] }); assert.equal(doc.entries.length, 2);
    assert.deepEqual(doc.entries.map(e => e.available), [true, false]); assert.equal(JSON.stringify(doc).includes('Saved answer'), false);
    assert.equal(doc.entries[0].latestAttempt, 2); assert.equal(h.db.questions.exportAnswers('q-a').some(a => 'answerMarkdown' in a), false);
  } finally { h.db.close(); }
});
test('export uses the selected attempt and cannot substitute a foreign answer', async () => {
  const h = harness(); try {
    assert.equal((await h.service.export(h.request())).status, 'saved'); assert.match(h.saved().text, /Saved answer/); assert.match(h.saved().text, /Claude/);
    assert.equal((await h.service.export({ selections: [{ target: h.target, revision: '', entryIds: ['foreign'] }] })).status, 'failed'); assert.equal(h.saved().writes, 1);
  } finally { h.db.close(); }
});
for (const action of ['grow', 'delete', 'reset', 'cancel'] as const) test(`fixed snapshot handles ${action} during the native dialog`, async () => {
  const h = harness(); try {
    h.db.questions.putAnswer({ ...questionAnswerFixture(), updatedAt: 11, capture: 'partial', sealedAt: null }, true, 0, true);
    h.choose(async () => {
      if (action === 'grow') h.db.questions.putAnswer({ ...questionAnswerFixture(), updatedAt: 12, answerMarkdown: 'Later text' }, true, 0, true);
      if (action === 'delete') h.db.questions.delete('q-a', 30, 'device-a'); if (action === 'reset') h.db.questions.invalidateLifecycle();
      return action === 'cancel' ? null : '/tmp/synthetic-export.md';
    });
    const result = await h.service.export(h.request()); assert.equal(result.status, action === 'grow' ? 'saved' : action === 'cancel' ? 'cancelled' : 'failed');
    assert.equal(h.saved().writes, action === 'grow' ? 1 : 0);
    if (action === 'grow') { assert.match(h.saved().text, /Saved answer/); assert.equal(h.saved().text.includes('Later text'), false); }
  } finally { h.db.close(); }
});
test('concurrent saving, cancellation, failure and disposal keep finite results', async () => {
  const h = harness(); let done!: (v: string | null) => void; try {
    h.choose(() => new Promise(resolve => { done = resolve; })); const first = h.service.export(h.request());
    assert.deepEqual(await h.service.export(h.request()), { status: 'failed', code: 'markdown_busy' }); done(null); assert.equal((await first).status, 'cancelled');
    h.choose(async () => { throw new Error('/private/location'); }); assert.deepEqual(await h.service.export(h.request()), { status: 'failed', code: 'markdown_failed' });
    const beforeDispose = h.request(); h.service.dispose(); assert.equal((await h.service.export(beforeDispose)).status, 'cancelled');
  } finally { h.db.close(); }
});

test('archive export rejects an obsolete selection revision before opening a save dialog', async () => {
  const h = harness(); try {
    assert.deepEqual(await h.service.export({ selections: [{ target: { kind: 'archive', id: 'archive-a' }, revision: 'old', entryIds: ['result:0'] }] }),
      { status: 'failed', code: 'markdown_source_changed' });
    assert.equal(h.saved().writes, 0);
    const [doc] = h.service.preview({ targets: [{ kind: 'archive', id: 'archive-a' }] });
    assert.equal((await h.service.export({ selections: [{ target: doc.target, revision: doc.revision, entryIds: ['result:0'] }] })).status, 'saved');
    assert.match(h.saved().text, /Rayleigh scattering/); assert.equal(h.saved().text.includes('undefined'), false);
  } finally { h.db.close(); }
});

test('real atomic writer preserves an existing file when the selected history is deleted during write', async () => {
  const { mkdtemp, writeFile, readFile, readdir, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os'); const { join } = await import('node:path');
  const { writeReportFile } = await import('../src/main/report-file');
  const dir = await mkdtemp(join(tmpdir(), 'polyask-md-')), file = join(dir, 'saved.md');
  const db = DesktopDatabase.open(':memory:'); db.questions.put(questionFixture()); db.questions.putAnswer(questionAnswerFixture());
  try {
    await writeFile(file, 'Original'); let guards = 0;
    const service = new MarkdownExportService({ questions: db.questions, archives: { get: () => null }, decisions: { get: () => null },
      epoch: () => db.questions.lifecycle, isCurrent: () => true, choosePath: async () => file,
      writeFile: async (path, data, guard) => writeReportFile(path, data, () => {
        if (++guards === 3) db.questions.delete('q-a', 30, 'device-a'); guard();
      }) });
    assert.deepEqual(await service.export({ selections: [{ target: { kind: 'history', id: 'q-a' }, revision: '', entryIds: [questionAnswerFixture().id] }] }),
      { status: 'failed', code: 'markdown_source_changed' });
    assert.equal(await readFile(file, 'utf8'), 'Original'); assert.deepEqual(await readdir(dir), ['saved.md']);
  } finally { db.close(); await rm(dir, { recursive: true, force: true }); }
});

test('normalized export locales retain Simplified and Traditional Chinese file labels', async () => {
  const h = harness(); try {
    await h.service.export({ ...h.request(), locale: 'zhCN' }); assert.match(h.saved().text, /导出时间/);
    await h.service.export({ ...h.request(), locale: 'zhTW' }); assert.match(h.saved().text, /匯出時間/);
  } finally { h.db.close(); }
});


test('archive export preserves the original question when its saved title is different', async () => {
  const h = harness({ ...archiveFixture(), task: 'Short saved title', text: 'Original question with context and separate instructions.' });
  try {
    const [doc] = h.service.preview({ targets: [{ kind: 'archive', id: 'archive-a' }] });
    assert.equal((await h.service.export({ selections: [{ target: doc.target, revision: doc.revision, entryIds: ['result:0'] }] })).status, 'saved');
    assert.equal(h.saved().text.includes('Short saved title'), true);
    assert.equal(new MarkdownIt().render(h.saved().text).includes('Original question with context and separate instructions.'), true);
  } finally { h.db.close(); }
});


for (const [label, title] of [['Chinese', '中'.repeat(100)], ['emoji', '🙂'.repeat(100)], ['ASCII', 'long-title-'.repeat(20)]] as const)
  test(`the default ${label} filename writes successfully and keeps the selected site`, async () => {
    const { mkdtemp, readFile, rm } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os'); const { join } = await import('node:path');
    const dir = await mkdtemp(join(tmpdir(), 'polyask-md-name-'));
    const db = DesktopDatabase.open(':memory:'); db.questions.put({ ...questionFixture(), text: title }); db.questions.putAnswer(questionAnswerFixture());
    let filename = '';
    const service = new MarkdownExportService({ questions: db.questions, archives: { get: () => null }, decisions: { get: () => null },
      epoch: () => 0, isCurrent: () => true, now: () => Date.UTC(2026, 9, 28),
      choosePath: async name => { filename = name; return join(dir, name); } });
    try {
      const result = await service.export({ selections: [{ target: { kind: 'history', id: 'q-a' }, revision: '', entryIds: [questionAnswerFixture().id] }] });
      assert.equal(result.status, 'saved');
      assert.equal(Buffer.byteLength(filename, 'utf8') <= 255, true);
      assert.match(filename, /-Claude-2026-10-28\.md$/);
      assert.equal(filename.includes('\ufffd'), false);
      assert.match(await readFile(join(dir, filename), 'utf8'), /Saved answer/);
    } finally { db.close(); await rm(dir, { recursive: true, force: true }); }
  });
