import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { transformSync } from 'esbuild';
import React from 'react';
import { BackupService } from '../src/main/backup-service';
import { DataAdminService } from '../src/main/data-admin-service';
import { DesktopDatabase } from '../src/main/database';
import { DraftRepository } from '../src/main/draft-repository';
import { LocalDataCard } from '../src/renderer/local-data-card';
import { BackupComparison } from '../src/renderer/backup-comparison';
import { parseComparisonContent, parseDecisionContent, parseSynthesisContent } from '../src/renderer/editor-draft-content';
import { setShellApi } from '../src/renderer/shell-api';
import { getCopy } from '../src/shared/copy';
import type { SyncStatus } from '../src/shared/sync';
import { readSource } from './fixtures';
import { mountDom } from './ui/dom-harness';

const preference = (value: unknown, updatedAt = 10, deviceId = 'source') => ({ value, updatedAt, deviceId });
const draft = (id = 'source-draft', text = 'Saved prompt', deviceId = 'source') => ({
  format: 1, id, kind: 'prompt', context: 'prompt', title: 'Prompt draft',
  content: { text }, updatedAt: 10, deviceId
});
const entry = (body: ReturnType<typeof draft>) => {
  const { deviceId, ...value } = body;
  return { kind: 'draft', id: body.id, body: value };
};
const document = (entries: unknown[]) => ({ format: 'polyask-backup', version: 3, exportedAt: 20, entries });
const status = (): SyncStatus => ({ state: 'idle', connected: false, pending: 0, errorCount: 0,
  readOnly: false, oauthConfigured: false, secureTokenStorage: true });
function setup() {
  const db = DesktopDatabase.open(':memory:');
  const backup = new BackupService(db, { deviceId: () => 'local', now: () => 100 });
  const admin = new DataAdminService({ database: db, deviceId: () => 'local', now: () => 100,
    sync: { disconnect: async () => status(), status } });
  return { db, backup, admin };
}

test('exports shared preferences and complete active draft content without device overlays or identity', () => {
  const { db, backup } = setup();
  try {
    db.meta.put('deviceId', 'private-device');
    db.meta.put('devicePreferences', { density: 'comfortable', follow: false, marker: 'private-overlay' });
    db.meta.put('draftSyncEnabled', true);
    db.state.put('preference:density', preference('compact', 10, 'private-device'), 10, false);
    db.state.put('draft:source-draft', draft('source-draft', 'Saved prompt', 'private-device'), 10, false);
    db.state.put('draft:removed', { ...draft('removed'), title: '', content: null, updatedAt: 11, deletedAt: 11 }, 11, false);
    const exported = backup.export();
    assert.equal(exported.version, 3);
    assert.deepEqual(exported.entries.map(value => value.kind).sort(), ['draft', 'preference']);
    assert.deepEqual(exported.entries.find(value => value.kind === 'preference')?.body, { value: 'compact', updatedAt: 10 });
    assert.deepEqual(exported.entries.find(value => value.kind === 'draft')?.body.content, { text: 'Saved prompt' });
    assert.equal(/private-device|private-overlay|draftSyncEnabled|devicePreferences|deviceId/.test(JSON.stringify(exported)), false);
  } finally { db.close(); }
});

test('restores only selected shared preferences with new local versions and retains device overrides', () => {
  const { db, backup } = setup();
  try {
    const overlay = { density: 'compact', siteScale: 0.9, follow: false };
    db.meta.put('devicePreferences', overlay);
    db.state.put('preference:density', preference('compact', 500, 'other-device'), 500, false);
    db.state.put('preference:siteScale', preference(0.9, 600, 'other-device'), 600, false);
    const preview = backup.preview(document([
      { kind: 'preference', id: 'density', body: { value: 'comfortable', updatedAt: 20, deviceId: 'injected' } },
      { kind: 'preference', id: 'siteScale', body: { value: 1, updatedAt: 20 } }
    ]));
    assert.deepEqual(backup.previewSelection(preview.token, ['preference:density']), {
      imported: 1, skipped: 1, keys: ['preference:density']
    });
    assert.deepEqual(backup.apply(preview.token, ['preference:density']), { imported: 1, skipped: 1 });
    assert.deepEqual(db.state.get('preference:density'), { value: 'comfortable', updatedAt: 501, deviceId: 'local' });
    assert.deepEqual(db.state.get('preference:siteScale'), preference(0.9, 600, 'other-device'));
    assert.deepEqual(db.meta.get('devicePreferences'), overlay);
    assert.deepEqual(db.outbox.ready(0).map(value => value.key), ['state:preference:density']);
  } finally { db.close(); }
});

test('copies conflicting draft branches independently and uses the same identity in preview and import', () => {
  const { db, backup } = setup();
  try {
    db.state.put('draft:source-draft', draft('source-draft', 'Local branch', 'local'), 10, false);
    const incoming = document([entry(draft())]);
    const preview = backup.preview(incoming);
    assert.equal(preview.items[0].status, 'conflict');
    assert.equal(preview.items[0].note, 'draft_new_identity');
    assert.equal(backup.previewSelection(preview.token, ['draft:source-draft']).imported, 1);
    assert.equal(backup.apply(preview.token, ['draft:source-draft']).imported, 1);
    const copies = db.state.entries<any>('draft:');
    assert.equal(copies.length, 2);
    assert.equal(db.state.get<any>('draft:source-draft').content.text, 'Local branch');
    const restored = copies.find(value => value.key !== 'draft:source-draft')!;
    assert.equal(restored.value.content.text, 'Saved prompt');
    assert.equal(restored.value.deviceId, `backup:${restored.value.id}`);
    db.state.put(restored.key, { ...restored.value, title: 'Edited restored branch', updatedAt: 200 }, 200, false);
    const again = backup.preview(incoming);
    assert.equal(backup.previewSelection(again.token, ['draft:source-draft']).imported, 0);
    assert.equal(backup.apply(again.token, ['draft:source-draft']).imported, 0);
    assert.equal(db.state.get<any>(restored.key).title, 'Edited restored branch');
    const another = backup.preview(document([entry(draft('source-draft', 'Second source branch', 'source-two'))]));
    assert.equal(backup.apply(another.token, ['draft:source-draft']).imported, 1);
    assert.equal(db.state.entries('draft:').length, 3);
  } finally { db.close(); }
});

test('deleted drafts stay skipped until selected and deleted imported copies never resurrect', () => {
  const { db, backup } = setup();
  try {
    const tombstone = { ...draft(), title: '', content: null, updatedAt: 30, deletedAt: 30 };
    db.state.put('draft:source-draft', tombstone, 30, false);
    const incoming = document([entry(draft())]), skipped = backup.preview(incoming);
    assert.equal(skipped.items[0].status, 'deleted');
    assert.equal(backup.apply(skipped.token, []).imported, 0);
    const selected = backup.preview(incoming);
    assert.equal(backup.apply(selected.token, ['draft:source-draft']).imported, 1);
    assert.deepEqual(db.state.get('draft:source-draft'), tombstone);
    const imported = db.state.entries<any>('draft:').find(value => value.key !== 'draft:source-draft')!;
    db.state.put(imported.key, { ...imported.value, title: '', content: null, updatedAt: 200, deletedAt: 200 }, 200, false);
    const again = backup.preview(incoming);
    assert.equal(again.items[0].blocked, true);
    assert.equal(backup.apply(again.token, ['draft:source-draft']).imported, 0);
    assert.equal(db.state.entries('draft:').length, 2);
  } finally { db.close(); }
});

test('old backups retain current drafts and shared preferences while validating version 3 kinds', () => {
  const { db, backup } = setup();
  try {
    db.state.put('preference:density', preference('comfortable'), 10, false);
    db.state.put('draft:source-draft', draft(), 10, false);
    for (const filename of ['backup-format1.json', 'backup-format2.json']) {
      const preview = backup.preview(JSON.parse(readFileSync(join(__dirname, 'fixtures', filename), 'utf8')));
      backup.apply(preview.token, preview.items.map(value => value.key));
      assert.deepEqual(db.state.get('preference:density'), preference('comfortable'));
      assert.deepEqual(db.state.get('draft:source-draft'), draft());
    }
    for (const invalid of [
      { kind: 'preference', id: 'unknown', body: { value: true, updatedAt: 10 } },
      { kind: 'preference', id: 'density', body: { value: 'invalid', updatedAt: 10 } },
      { kind: 'preference', id: 'density', body: { value: 'compact', updatedAt: 10, deletedAt: 11 } },
      { ...entry(draft()), body: { ...entry(draft()).body, format: 2 } }
    ]) assert.throws(() => backup.preview(document([invalid])), /backup_invalid/);
    assert.throws(() => backup.preview({ ...document([entry(draft())]), version: 2 }), /backup_version/);
  } finally { db.close(); }
});

test('draft and shared preference changes invalidate an already reviewed backup', () => {
  const { db, backup } = setup();
  try {
    const incoming = document([entry(draft())]);
    const preview = backup.preview(incoming);
    db.state.put('preference:density', preference('compact'), 10, false);
    assert.throws(() => backup.apply(preview.token, ['draft:source-draft']), /backup_stale/);
    const next = backup.preview(incoming);
    db.state.put('draft:unrelated', draft('unrelated'), 10, false);
    assert.throws(() => backup.apply(next.token, ['draft:source-draft']), /backup_stale/);
    assert.equal(db.state.get('draft:source-draft'), null);
  } finally { db.close(); }
});

test('draft clearing counts active records, creates terminal tombstones and retains shared preferences', () => {
  const { db, admin } = setup();
  try {
    db.state.put('draft:source-draft', draft('source-draft', 'Saved prompt', 'local'), 10, false);
    db.state.put('draft:second', { ...draft('second'), updatedAt: 500 }, 500, false);
    const removed = { ...draft('removed'), title: '', content: null, updatedAt: 20, deletedAt: 20 };
    db.state.put('draft:removed', removed, 20, false);
    db.state.put('preference:density', preference('compact'), 10, false);
    assert.equal((admin.stats() as any).drafts, 2);
    assert.equal((admin.stats().reset as any).preferences, 1);
    assert.equal((admin as any).clearDrafts(), 2);
    assert.equal((admin.stats() as any).drafts, 0);
    assert.equal(db.state.entries('draft:').length, 3);
    assert.deepEqual(db.state.get('draft:source-draft'), {
      format: 1, id: 'source-draft', kind: 'prompt', context: 'prompt', title: '', content: null,
      updatedAt: 100, deletedAt: 100, deviceId: 'local'
    });
    assert.equal(db.state.get<any>('draft:second').deletedAt, 501);
    assert.equal(db.state.get<any>('draft:second').deviceId, 'source');
    assert.deepEqual(db.state.get('draft:removed'), removed);
    assert.deepEqual(db.state.get('preference:density'), preference('compact'));
    assert.deepEqual(db.outbox.ready(0).map(value => value.key).sort(), ['state:draft:second', 'state:draft:source-draft']);
  } finally { db.close(); }
});

test('restored backup drafts stay separate when autosaving or removing the local form branch', () => {
  const { db, backup } = setup();
  try {
    db.meta.put('deviceId', 'local');
    const preview = backup.preview(document([entry(draft())]));
    backup.apply(preview.token, preview.items.map(value => value.key));
    const restored = db.state.entries<any>('draft:')[0];
    const repository = new DraftRepository(db.state, db.meta, { deviceId: () => 'local', now: () => 200, createId: () => 'own-draft' });
    const own = repository.save({ kind: 'prompt', context: 'prompt', title: 'Current prompt', content: { text: 'New edit' } });
    assert.equal(own.id, 'own-draft');
    assert.equal(repository.list('prompt', 'prompt').length, 2);
    assert.equal(repository.removeOwn('prompt', 'prompt'), true);
    assert.equal(repository.list('prompt', 'prompt').length, 1);
    assert.deepEqual(db.state.get(restored.key), restored.value);
  } finally { db.close(); }
});

test('frozen version 3 fixture round trips all form kinds and explicit null shared preferences', () => {
  const { db, backup } = setup();
  try {
    const input = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'backup-v3-preferences-drafts.json'), 'utf8'));
    const preview = backup.preview(input);
    assert.equal(preview.items.length, 6);
    assert.equal(backup.apply(preview.token, preview.items.map(value => value.key)).imported, 6);
    const exported = backup.export();
    assert.equal(exported.entries.filter(value => value.kind === 'draft').length, 4);
    assert.equal(exported.entries.find(value => value.id === 'workbenchGuide')?.body.value, null);
    for (const source of input.entries.filter((value: any) => value.kind === 'draft')) {
      assert.deepEqual(exported.entries.find(value => value.kind === 'draft' && value.body.kind === source.body.kind)?.body.content, source.body.content);
      const parser = source.body.kind === 'comparison' ? parseComparisonContent : source.body.kind === 'decision' ? parseDecisionContent : null;
      if (parser) assert.equal(parser(source.body.content, 'archive-fixture') === null, false);
      if (source.body.kind === 'synthesis') assert.equal(parseSynthesisContent(source.body.content) === null, false);
    }
    assert.equal(JSON.stringify(exported).includes('deviceId'), false);
  } finally { db.close(); }
});

test('local reset removes preferences, draft state and device overlays after disconnect while preserving device id', async () => {
  const { db, admin } = setup();
  try {
    db.meta.put('deviceId', 'local');
    db.meta.put('devicePreferences', { density: 'comfortable' });
    db.meta.put('draftSyncEnabled', true);
    db.state.put('preference:density', preference('compact'), 10);
    db.state.put('draft:source-draft', draft(), 10);
    await admin.resetLocal();
    assert.equal(db.state.get('draft:source-draft'), null);
    assert.equal(db.state.get('preference:density'), null);
    assert.equal(db.meta.get('devicePreferences'), null);
    assert.equal(db.meta.get('draftSyncEnabled'), null);
    assert.equal(db.meta.get('deviceId'), 'local');
    assert.equal(db.outbox.count(), 0);
  } finally { db.close(); }
});

test('clear drafts IPC requires a trusted sender and explicit confirmation and disposes its handler', () => {
  const { db, admin } = setup();
  const handlers = new Map<string, (event: unknown, value?: unknown) => unknown>();
  const module = { exports: {} as { registerDataAdminIpc: (options: unknown) => () => void } };
  runInNewContext(transformSync(readSource('src/main/data-admin-ipc.ts'), { loader: 'ts', format: 'cjs' }).code, {
    module, exports: module.exports, require: (name: string) => {
      assert.equal(name, 'electron');
      return { ipcMain: { handle: (key: string, handler: any) => handlers.set(key, handler), removeHandler: (key: string) => handlers.delete(key) } };
    }
  });
  let notifications = 0;
  const dispose = module.exports.registerDataAdminIpc({ admin, trusted: (event: unknown) => event === true,
    afterHistoryChange: () => {}, afterReset: () => {}, afterDraftsChange: () => notifications++ });
  try {
    db.state.put('draft:source-draft', draft(), 10, false);
    const clear = handlers.get('polyask:clear-drafts');
    assert.equal(typeof clear, 'function');
    assert.throws(() => clear!(false, true), /untrusted_sender/);
    for (const confirmation of [undefined, false, 1, 'true', { confirmed: true }]) {
      assert.throws(() => clear!(true, confirmation), /invalid_request/);
    }
    assert.equal(admin.stats().drafts, 1);
    assert.equal(notifications, 0);
    assert.equal(clear!(true, true), 1);
    assert.equal(admin.stats().drafts, 0);
    assert.equal(notifications, 1);
    assert.equal(db.outbox.count(), 1);
  } finally { dispose(); db.close(); }
  assert.equal(handlers.size, 0);
});

test('draft clearing confirmation keeps data on cancel and rechecks changed counts before writing', async () => {
  const { db, admin } = setup(), copy = getCopy('en');
  const feedback: string[] = [];
  let writes = 0;
  db.state.put('draft:source-draft', draft(), 10, false);
  db.state.put('preference:density', preference('compact'), 10, false);
  setShellApi({ getLocalDataStats: async () => admin.stats(), clearDrafts: async (confirmed: unknown) => {
    assert.equal(confirmed, true); writes++; return admin.clearDrafts();
  } } as any);
  const h = await mountDom(React.createElement(LocalDataCard, { copy, busy: false, onBusy: () => {},
    onFeedback: message => feedback.push(message), onStatus: () => {} }));
  const button = (text: string) => [...h.document.querySelectorAll<HTMLButtonElement>('button')].find(value => value.textContent === text)!;
  const confirm = () => h.document.querySelector<HTMLButtonElement>('[data-local-confirm]')!;
  try {
    await h.click(button(copy.clearDraftsAction));
    assert.match(h.document.querySelector('[role="dialog"]')!.textContent!, /Saved drafts: 1/);
    await h.click(button(copy.cancel));
    assert.equal(writes, 0);
    assert.equal(admin.stats().drafts, 1);
    await h.click(button(copy.clearDraftsAction));
    db.state.put('draft:second', draft('second'), 10, false);
    await h.click(confirm());
    assert.equal(writes, 0);
    assert.match(h.document.querySelector('[role="dialog"]')!.textContent!, /Counts changed.*Saved drafts: 2/s);
    await h.click(confirm());
    assert.equal(writes, 1);
    assert.equal(admin.stats().drafts, 0);
    assert.equal(db.state.get<any>('preference:density').value, 'compact');
    assert.deepEqual(feedback, ['Cleared 2 drafts']);
    assert.equal(h.document.querySelector('[role="dialog"]') === null, true);
  } finally { await h.close(); setShellApi(null); db.close(); }
});

test('backup review localizes shared preference names and explains terminal deleted draft copies', async () => {
  const { db, backup } = setup();
  try {
    const preview = backup.preview(document([{ kind: 'preference', id: 'density', body: { value: 'comfortable', updatedAt: 10 } }]));
    const localized = await mountDom(React.createElement(BackupComparison, { item: preview.items[0], copy: getCopy('zh-CN'),
      selected: false, onSelect: () => {}, locale: 'zh-CN' }));
    try {
      assert.equal(localized.document.querySelector('h3')!.textContent, '界面密度');
      assert.match(localized.document.querySelector('.backup-versions')!.textContent!, /舒适/);
      assert.equal(localized.document.querySelector('.backup-versions')!.textContent!.includes('comfortable'), false);
    } finally { await localized.close(); }
    const incoming = document([entry(draft())]), imported = backup.preview(incoming);
    backup.apply(imported.token, imported.items.map(value => value.key));
    const restored = db.state.entries<any>('draft:')[0];
    db.state.put(restored.key, { ...restored.value, title: '', content: null, updatedAt: 200, deletedAt: 200 }, 200, false);
    const deleted = backup.preview(incoming);
    const h = await mountDom(React.createElement(BackupComparison, { item: deleted.items[0], copy: getCopy('en'),
      selected: false, onSelect: () => {} }));
    try {
      assert.match(h.document.querySelector('[role="status"]')!.textContent!, /backup draft was deleted/);
      assert.equal(h.document.querySelector('input[type="checkbox"]') === null, true);
    } finally { await h.close(); }
  } finally { db.close(); }
});
