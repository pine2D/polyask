import assert from 'node:assert/strict';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { transformSync } from 'esbuild';
import { DesktopDatabase } from '../src/main/database';
import { DraftRepository } from '../src/main/draft-repository';
import { SyncRepository } from '../src/main/sync-repository';
import { BackupService } from '../src/main/backup-service';
import { parseStoredDraft, type StoredDraft } from '../src/shared/drafts';
import { validSyncTime } from '../src/shared/sync';
import { readSource } from './fixtures';

const content = { archiveId: 'source', sourceUpdatedAt: 100, title: 'Reviewed judgment',
  conclusion: 'Keep my reasoning', rationale: '', uncertainties: '', nextStep: '', status: 'draft', evidence: [] };
const input = { kind: 'decision' as const, context: 'archive:source', title: 'Reviewed judgment', content };

function oldReader(draft: StoredDraft): unknown {
  const code = transformSync(readSource('test/fixtures/task3-drafts.ts.txt'), { loader: 'ts', format: 'cjs' }).code;
  const module = { exports: {} };
  // Parse in the reader's realm, otherwise its plain-object check alone would reject every input.
  return runInNewContext(`${code}\nmodule.exports.parseStoredDraft(JSON.parse(serialized));`,
    { module, exports: module.exports, require: () => ({ validSyncTime }), TextEncoder, serialized: JSON.stringify(draft) });
}

test('a reviewed decision without excerpts protects its version from old draft readers', () => {
  const db = DesktopDatabase.open(':memory:'); db.meta.put('deviceId', 'local');
  const drafts = new DraftRepository(db.state, db.meta), sync = new SyncRepository(db);
  const backup = new BackupService(db, { deviceId: () => 'local', now: () => 200 });
  try {
    drafts.setSyncEnabled(true);
    const saved = drafts.save(input);
    const legacy = { ...saved, format: 1 as const, content: { ...content } };
    delete (legacy.content as Partial<typeof content>).sourceUpdatedAt;
    assert.equal(oldReader(legacy) !== null, true, 'positive control: the frozen reader accepts a genuine old draft');
    assert.equal(oldReader(saved) === null, true, 'old readers must not silently strip the reviewed source version');
    assert.equal(saved.format, 2);
    assert.equal(sync.localStateFragment().schema, 6);
    assert.equal(backup.export().version, 5);
    drafts.remove(saved.id);
    assert.equal(drafts.get(saved.id)?.format, 2);
    assert.equal(sync.localStateFragment().schema, 6);
  } finally { backup.dispose(); db.close(); }
});

test('previous version-only format1 drafts stay readable and export safely before being edited again', () => {
  const db = DesktopDatabase.open(':memory:'); db.meta.put('deviceId', 'local');
  const drafts = new DraftRepository(db.state, db.meta, { now: () => 300 });
  const sync = new SyncRepository(db), backup = new BackupService(db, { deviceId: () => 'local', now: () => 400 });
  const previous: StoredDraft = { ...input, format: 1, id: 'existing', deviceId: 'local', updatedAt: 200 };
  try {
    db.state.put('draft:existing', previous, 200, false);
    assert.deepEqual(drafts.get('existing')?.content, content, 'repair must retain already saved editing labor');
    drafts.setSyncEnabled(true);
    const state = sync.localStateFragment();
    assert.equal(state.schema, 6);
    assert.equal((state.settings['polyask.draft.existing'].value as { format: number }).format, 2);
    const document = backup.export();
    assert.equal(document.version, 5);
    assert.equal(document.entries.find(entry => entry.kind === 'draft')?.body.format, 2);
    const saved = drafts.save(input);
    assert.equal(saved.id, 'existing'); assert.equal(saved.format, 2);
    assert.equal(saved.updatedAt, 300);
    assert.deepEqual(saved.content, content);
    const { sourceUpdatedAt: ignored, ...legacyContent } = content;
    assert.equal(drafts.save({ ...input, context: 'legacy', content: legacyContent }).format, 1);
    assert.equal(parseStoredDraft({ ...previous, content: { ...content, evidence: [{ id: 'extended' }] } }), null,
      'the compatibility read must not admit arbitrary extended evidence under format1');
  } finally { backup.dispose(); db.close(); }
});

test('disabled draft sync still protects versioned drafts carried from an earlier own cloud fragment', () => {
  const db = DesktopDatabase.open(':memory:'); db.meta.put('deviceId', 'local');
  try {
    db.meta.put('remoteStates', { own: { schema: 1, deviceId: 'local', templates: {}, groups: {}, settings: {
      'polyask.draft.existing': { value: { ...input, id: 'existing', format: 1 }, updatedAt: 200, deviceId: 'local' }
    } } });
    const fragment = new SyncRepository(db).localStateFragment();
    assert.equal(fragment.schema, 6);
    assert.deepEqual((fragment.settings['polyask.draft.existing'].value as { content: unknown }).content, content);
  } finally { db.close(); }
});
