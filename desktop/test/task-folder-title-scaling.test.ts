import assert from 'node:assert/strict';
import test from 'node:test';
import { DesktopDatabase } from '../src/main/database';
import { createLocalDataServices } from '../src/main/local-data-services';
import { createArchiveRecord } from '../src/shared/archive';

test('title pages preserve locale order and selected targets without joining all ranks', () => {
  const db = DesktopDatabase.open(':memory:'), { folders, archives, decisions } = createLocalDataServices(db);
  try {
    const folder = folders.create('Project');
    for (let i = 0; i < 230; i++) {
      const title = ['农业', 'ÉVIDENCE', '100%_', 'İSTANBUL'][i % 4] + ` ${230 - i}`;
      const source = createArchiveRecord({ text: title, task: title, results: [] }, { id: `a${i}`, now: i + 1, deviceId: 'test' });
      db.archives.put(source, false);
      if (i % 2) {
        const card = decisions.create({ archiveId: source.id, title, conclusion: title, rationale: '', uncertainties: '', nextStep: '', status: 'draft', evidence: [] });
        db.decisions.put({ ...card, id: source.id }, false); decisions.delete(card.id);
        if (i % 3 === 0) folders.patchMemberships({ kind: 'decision', id: source.id }, [{ folderId: folder.id, present: true }]);
      }
      if (i % 3 === 0) folders.patchMemberships({ kind: 'archive', id: source.id }, [{ folderId: folder.id, present: true }]);
    }
    const original = (db as any).database.prepare.bind((db as any).database), rankWidths: number[] = [];
    (db as any).database.prepare = (sql: string) => {
      const statement = original(sql);
      // Observe actual SQL bindings rather than machine-dependent elapsed-time thresholds.
      if (/rank_kind|rank_id/.test(sql)) return new Proxy(statement, { get(target, key) {
        const value = target[key];
        return typeof value !== 'function' ? value : (...params: unknown[]) => {
          for (const p of params) if (typeof p === 'string' && p.startsWith('[{"kind"')) rankWidths.push(JSON.parse(p).length);
          return value.apply(target, params);
        };
      } });
      return statement;
    };
    for (const locale of ['en', 'zh-CN', 'zh-TW']) for (const filters of [{}, { query: '100%_' }, { query: 'i̇stanbul' }, { folderId: folder.id }, { folderId: '__unfiled__' }]) {
      const collator = new Intl.Collator(locale, { sensitivity: 'base', numeric: true });
      const matches = folders.search(filters).sort((a, b) => collator.compare(a.kind === 'archive' ? a.record.task || a.record.preview : a.record.title,
        b.kind === 'archive' ? b.record.task || b.record.preview : b.record.title) || a.record.id.localeCompare(b.record.id) || a.kind.localeCompare(b.kind));
      const identity = (x: { kind: 'archive' | 'decision'; record: { id: string } }) => ({ kind: x.kind, id: x.record.id });
      const selected = identity(matches.at(-1)!);
      const selectedTargets = [identity(matches[0]), selected, { kind: 'archive' as const, id: 'absent' }];
      for (const pageIndex of [0, 1, 3, 99]) {
        const plain = folders.query({ ...filters, sort: 'title-asc', locale, page: pageIndex });
        const expected = Math.min(pageIndex, Math.floor((matches.length - 1) / 100));
        assert.equal(plain.page, expected); assert.deepEqual(plain.items.map(identity), matches.slice(expected * 100, expected * 100 + 100).map(identity));
      }
      const page = folders.query({ ...filters, sort: 'title-asc', locale, selected, selectedTargets, locateSelected: true });
      assert.equal(page.total, matches.length); assert.equal(page.page, Math.floor((matches.length - 1) / 100));
      assert.equal(page.selectedPage, page.page); assert.deepEqual(page.selected, selected);
      assert.deepEqual(page.selectedTargets, selectedTargets.slice(0, 2));
      assert.deepEqual(page.items.map(identity), matches.slice(page.page * 100, page.page * 100 + 100).map(identity));
      const retained = folders.query({ ...filters, sort: 'title-asc', locale, page: 0, selected });
      assert.equal(retained.page, 0); assert.equal(retained.selectedPage, page.selectedPage); assert.deepEqual(retained.selected, selected);
      assert.equal(folders.query({ ...filters, sort: 'title-asc', page: 99, locateSelected: true }).page, 0);
      const missing = folders.query({ ...filters, sort: 'title-asc', selected: { kind: 'archive', id: 'absent' }, locateSelected: true, page: 99 });
      assert.equal(missing.page, 0); assert.equal(missing.selected, null); assert.equal(missing.selectedPage, null);
    }
    assert.equal(rankWidths.every(n => n <= 100), true, `title summary joins must bind one page, max=${Math.max(...rankWidths)}`);
    assert.equal(archives.get('a0')?.task, '农业 230');
  } finally { db.close(); }
});
