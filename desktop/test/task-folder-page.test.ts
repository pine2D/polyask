import assert from 'node:assert/strict';
import test from 'node:test';
import { performance } from 'node:perf_hooks';
import { DesktopDatabase } from '../src/main/database';
import { createLocalDataServices } from '../src/main/local-data-services';
import { createArchiveRecord } from '../src/shared/archive';

function fixture() {
  const db = DesktopDatabase.open(':memory:');
  const services = createLocalDataServices(db);
  return { db, ...services, query: (request: any = {}) => {
    assert.equal(typeof (services.folders as any).query, 'function', 'folder list must have a bounded SQL query');
    return (services.folders as any).query(request);
  } };
}

test('SQL pages project only bounded summaries and preserve off-page targets at a thousand long answers', t => {
  const f = fixture();
  try {
    const text = 'LONG_BODY_DO_NOT_PROJECT '.repeat(800);
    for (let index = 0; index < 1_000; index++) f.db.archives.put(createArchiveRecord({
      text: `Question ${index}`, task: `Result ${index}`, createdAt: index + 1,
      results: [{ host: 'claude.ai', label: 'Claude', text }],
    }, { id: `r-${String(index).padStart(4, '0')}`, now: index + 1, deviceId: 'test' }), false);
    const started = performance.now();
    const page = f.query({ page: 9, selected: { kind: 'archive', id: 'r-0999' },
      selectedTargets: [{ kind: 'archive', id: 'r-0999' }, { kind: 'archive', id: 'r-0000' }] });
    const elapsed = performance.now() - started, bytes = Buffer.byteLength(JSON.stringify(page));
    assert.equal(page.total, 1_000); assert.equal(page.page, 9); assert.equal(page.items.length, 100);
    assert.equal(page.items[0].record.id, 'r-0099'); assert.equal(page.items.at(-1).record.id, 'r-0000');
    assert.equal(page.selectedPage, 0); assert.equal(page.selectedTargets.length, 2);
    assert.equal('text' in page.items[0].record, false);
    assert.equal('searchText' in page.items[0].record, false);
    assert.equal('text' in page.items[0].record.results[0], false);
    assert.equal(JSON.stringify(page).includes('LONG_BODY_DO_NOT_PROJECT'), false);
    assert.equal(bytes < 80_000, true, `summary page bytes=${bytes}`);
    assert.equal(f.archives.get('r-0000')!.results[0].text, text);
    t.diagnostic(`SQLite 1000 × ${Buffer.byteLength(text)} byte answers: page ${elapsed.toFixed(1)}ms, IPC ${bytes} bytes`);
  } finally { f.db.close(); }
});

test('SQL mixed query applies membership, literal Unicode search and independent type filters before counting', () => {
  const f = fixture();
  try {
    const archive = f.archives.add({ text: 'Question', task: 'Question', results: [{ host: 'claude.ai', label: 'Claude', text: 'ÉVIDENCE 100%_ literal' }] });
    const card = f.decisions.create({ archiveId: archive.id, title: 'Card 10', conclusion: 'ÉVIDENCE 100%_', rationale: '',
      uncertainties: '', nextStep: '', status: 'final', evidence: [] });
    const folder = f.folders.create('Project'), targets = [{ kind: 'archive', id: archive.id }, { kind: 'decision', id: card.id }];
    f.folders.patchMemberships({ kind: 'decision', id: card.id }, [{ folderId: folder.id, present: true }]);
    assert.equal(f.query({ query: 'évidence 100%_' }).total, 2);
    assert.equal(f.query({ folderId: folder.id }).total, 1);
    assert.equal(f.query({ folderId: '__unfiled__' }).items[0].kind, 'archive');
    assert.equal(f.query({ favorite: true, status: 'final' }).items[0].kind, 'decision');
    const page = f.query({ folderId: folder.id, selectedTargets: targets, selected: targets[0] });
    assert.equal(page.selected, null); assert.equal(page.selectedPage, null);
    assert.equal(page.selectedTargets.length, 1); assert.equal(page.selectedTargets[0].kind, 'decision');
    f.folders.delete(folder.id);
    assert.equal(f.query({ folderId: '__unfiled__' }).total, 2);
    f.decisions.delete(card.id);
    assert.equal(f.query({ query: 'évidence' }).total, 1);
  } finally { f.db.close(); }
});

test('title sorting uses locale numeric order and clamps empty or shrinking pages', () => {
  const f = fixture();
  try {
    for (const title of ['Result 10', 'Result 2', 'Result 1']) f.archives.add({ text: title, task: title, results: [] });
    const page = f.query({ sort: 'title-asc', locale: 'en', page: 20 });
    assert.equal(page.page, 0);
    assert.equal(page.items.map((item: any) => item.record.task).join(','), 'Result 1,Result 2,Result 10');
    assert.equal(f.query({ query: 'missing', page: 20 }).page, 0);
    for (const request of [{ page: -1 }, { page: 1.2 }, { page: Infinity }, { sort: 'wrong' },
      { query: 'x'.repeat(65_537) }, { selected: { kind: 'history', id: 'a' } }, { selectedTargets: 'bad' },
      { selectedTargets: Array.from({ length: 20_001 }, () => ({ kind: 'archive', id: 'a' })) }])
      assert.throws(() => f.query(request), /invalid_request/);
  } finally { f.db.close(); }
});

test('title collation still compares the complete long title while its list projection stays bounded', () => {
  const f = fixture();
  try {
    for (const suffix of ['10', '2']) f.db.archives.put(createArchiveRecord({ text: 'Question',
      task: `${'Same prefix '.repeat(60)}${suffix}`, results: [] },
      { id: `long-${suffix}`, now: 100, deviceId: 'test' }), false);
    const page = f.query({ sort: 'title-asc', locale: 'en' });
    assert.equal(page.items.map((item: any) => item.record.id).join(','), 'long-2,long-10');
    assert.equal([...page.items[0].record.task].length, 512);
  } finally { f.db.close(); }
});
