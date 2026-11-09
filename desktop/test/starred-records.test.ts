import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DesktopDatabase } from '../src/main/database';
import { createLocalDataServices } from '../src/main/local-data-services';
import { BackupService } from '../src/main/backup-service';
import { validateBackup } from '../src/main/backup-validation';
import { SyncRepository } from '../src/main/sync-repository';
import { isStoredQuestion } from '../src/shared/question-history';
import { isStoredDecision } from '../src/shared/decision';
import { questionFixture } from './question-fixtures';

test('history stars survive restart, retain date order, filter before pagination and enqueue both directions', () => {
  const directory = mkdtempSync(join(tmpdir(), 'polyask-stars-db-'));
  const path = join(directory, 'test.sqlite');
  let db = DesktopDatabase.open(path);
  try {
    for (let i = 0; i < 105; i++) db.questions.put({ ...questionFixture(`q-${i}`), createdAt: i + 1, updatedAt: i + 1 });
    db.questions.setFavorite('q-2', true, 200, 'local');
    db.questions.setFavorite('q-99', true, 201, 'local');
    assert.equal(db.questions.search().items[0].id, 'q-104');
    const first = db.questions.search({ favorite: true, limit: 1 });
    assert.equal(first.items[0].id, 'q-99');
    assert.equal(db.questions.search({ favorite: true, cursor: first.cursor!, limit: 1 }).items[0].id, 'q-2');
    assert.equal(db.questions.search({ favorite: true, query: 'not present' }).items.length, 0);
    db.close(); db = DesktopDatabase.open(path);
    assert.equal(db.questions.search({ favorite: true }).items.length, 2);
    const current = db.questions.setFavorite('q-2', false, 199, 'local');
    assert.equal(current.updatedAt, 201); assert.equal(current.schema, 7);
    assert.equal(db.questions.search({ favorite: true }).items.length, 1);
    const repository = new SyncRepository(db);
    assert.equal(db.outbox.ready(1000, 200).some(op => op.key === 'question:q-2'), true);
    assert.equal(repository.importQuestion({ ...current, favorite: true, updatedAt: 200 }), true);
    assert.equal((db.questions.get('q-2') as any).favorite, false);
    db.questions.delete('q-2', 300, 'local');
    assert.equal(db.questions.get('q-2')!.schema, 7);
    assert.throws(() => db.questions.setFavorite('q-2', true, 400, 'local'), /history_not_found/);
    assert.equal(repository.importQuestion({ ...current, favorite: true, updatedAt: 500 }), true);
    assert.equal('deletedAt' in db.questions.get('q-2')!, true);
  } finally { db.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('mixed library stars cover answers and decisions and survive editing, backup, restore and reset', () => {
  const db = DesktopDatabase.open(':memory:'), target = DesktopDatabase.open(':memory:');
  const { archives, decisions, folders } = createLocalDataServices(db);
  const backup = new BackupService(db, { deviceId: () => 'source', now: () => 500 });
  const restore = new BackupService(target, { deviceId: () => 'target', now: () => 600 });
  try {
    const a = archives.add({ text: 'Starred answer', task: 'Starred answer', results: [] });
    const input = { archiveId: a.id, title: 'Starred decision', status: 'draft' as const, conclusion: '', rationale: '', uncertainties: '', nextStep: '', evidence: [] };
    const d = decisions.create(input);
    assert.equal(folders.query({ favorite: true }).total, 0);
    archives.update(a.id, { favorite: true }); decisions.setFavorite(d.id, true);
    assert.equal(folders.query({ favorite: true }).total, 2);
    assert.equal(folders.query({ favorite: true, kind: 'decision' }).items[0].record.favorite, true);
    assert.equal(folders.search({ favorite: true }).length, 2);
    const changed = decisions.update(d.id, { ...input, title: 'Edited title' });
    assert.equal(changed.favorite, true); assert.equal(changed.schema, 7);
    db.questions.put(questionFixture()); db.questions.setFavorite('q-a', true, 300, 'source');
    const document = backup.export();
    assert.equal(document.version, 6);
    assert.throws(() => validateBackup({ ...document, version: 5 }), /backup_version/);
    const preview = restore.preview(document);
    restore.apply(preview.token, preview.items.map(item => item.key));
    assert.equal(target.questions.search({ favorite: true }).items.length, 1);
    assert.equal((target.archives.get(a.id) as any).favorite, true);
    assert.equal((target.decisions.get(d.id) as any).favorite, true);
    decisions.setFavorite(d.id, false);
    assert.equal(folders.query({ favorite: true, kind: 'decision' }).total, 0);
    decisions.delete(d.id);
    assert.equal(db.decisions.get(d.id)!.schema, 7);
    assert.throws(() => decisions.setFavorite(d.id, true), /not_found/);
    target.resetLocalData();
    assert.equal(target.questions.search({ favorite: true }).items.length, 0);
    assert.equal(target.decisions.get(d.id), null);
  } finally { backup.dispose(); restore.dispose(); db.close(); target.close(); }
});

test('star fields have an explicit schema boundary and reject invalid values', () => {
  const q = questionFixture();
  assert.equal(isStoredQuestion(q), true);
  assert.equal(isStoredQuestion({ ...q, favorite: true }), false);
  assert.equal(isStoredQuestion({ ...q, schema: 7, favorite: true }), true);
  assert.equal(isStoredQuestion({ ...q, schema: 7, favorite: 'yes' }), false);
  assert.equal(isStoredQuestion({ ...q, schema: 7 }), false);
  const db = DesktopDatabase.open(':memory:');
  try {
    const { archives, decisions } = createLocalDataServices(db);
    const a = archives.add({ text: 'Question', task: 'Question', results: [] });
    const d = decisions.create({ archiveId: a.id, title: 'Decision', status: 'draft', conclusion: '', rationale: '', uncertainties: '', nextStep: '', evidence: [] });
    assert.equal(isStoredDecision({ ...d, favorite: true }), false);
    assert.equal(isStoredDecision({ ...d, schema: 7, favorite: false }), true);
    assert.equal(isStoredDecision({ ...d, schema: 7, favorite: 1 }), false);
    assert.throws(() => decisions.setFavorite(d.id, 'yes' as any), /invalid_favorite/);
  } finally { db.close(); }
});
