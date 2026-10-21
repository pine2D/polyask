import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { DesktopDatabase } from '../src/main/database';
import { SyncRepository } from '../src/main/sync-repository';
import { SyncEngine, type SyncDrive } from '../src/main/sync-engine';
import { question, wire } from './lib/question-attachment-fixtures';

function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
const turn = () => new Promise<void>(resolve => setImmediate(resolve));
function setup() {
  const db = DesktopDatabase.open(':memory:'); db.meta.put('deviceId', 'device');
  const repo = new SyncRepository(db); repo.saveConfig({ connected: true }); repo.setImageSyncEnabled(true);
  db.questions.put(question(), false);
  const body = { ...wire(), schema: 6 };
  const file = { id: 'future', appProperties: { app: 'polyask', kind: 'questionAttachments', schema: '5',
    id: createHash('sha256').update(body.id).digest('hex'), deleted: '0' } };
  const uploads: string[] = [], events: string[] = [];
  const drive: SyncDrive = {
    getStartToken: async () => 'start', listFiles: async () => [],
    listChanges: async () => ({ changes: [], newStartPageToken: 'next' }),
    download: async () => { events.push('download'); return body; },
    upsert: async (_id, _name, props) => { uploads.push(props.id); events.push('upload'); return { id: props.id }; },
    remove: async () => { events.push('remove'); }, clearAll: async () => {}
  };
  const engine = new SyncEngine({ repository: repo, drive, auth: { configured: () => true,
    securePersistence: () => true, connect: async () => {}, disconnect: async () => {} } });
  return { db, repo, body, file, uploads, events, drive, engine };
}

for (const phase of ['upload', 'pull'] as const) {
  test(`explicit image fetch waits for pending ${phase} and its future lock survives the next round`, async () => {
    const s = setup(), started = deferred<void>(), release = deferred<void>();
    let fetch: Promise<boolean> | undefined, sync: ReturnType<SyncEngine['syncNow']> | undefined;
    try {
      s.db.questions.put(question('a', 0)); s.db.questions.put(question('b', 0));
      if (phase === 'upload') {
        const upsert = s.drive.upsert;
        s.drive.upsert = async (...args) => {
          if (s.uploads.length === 0) { started.resolve(); await release.promise; }
          return upsert(...args);
        };
      } else s.drive.listChanges = async () => {
        started.resolve(); await release.promise; return { changes: [], newStartPageToken: 'next' };
      };
      sync = s.engine.syncNow(); await started.promise;
      let fetchListings = 0;
      s.drive.listFiles = async () => { fetchListings++; return [s.file]; };
      fetch = s.engine.fetchQuestionAttachments('q-a');
      await turn();
      assert.equal(fetchListings, 0, 'fetch must not acquire state ownership during an active sync');
      release.resolve(); await sync;
      assert.equal(await fetch, false);
      assert.equal(s.repo.config().readOnly, true);
      assert.equal(s.repo.config().futureFiles?.future, 6);
      assert.equal(s.uploads.length, 2, 'the prior round finishes before discovering future schema');
      assert.equal(s.events.indexOf('download'), 2, 'no upload follows the future-body read');
      s.db.questions.put(question('c', 0));
      await s.engine.syncNow();
      assert.equal(s.repo.config().readOnly, true);
      assert.equal(s.repo.config().futureFiles?.future, 6);
      assert.equal(s.uploads.length, 2, 'subsequent rounds must honor the discovered lock');
      assert.equal(s.events.includes('remove'), false);
    } finally { release.resolve(); await sync; await fetch; s.engine.dispose(); s.db.close(); }
  });
}

test('sync queued behind explicit fetch observes future-body lock before any upload', async () => {
  const s = setup(), started = deferred<void>(), release = deferred<void>();
  let fetch: Promise<boolean> | undefined, sync: ReturnType<SyncEngine['syncNow']> | undefined;
  try {
    let listings = 0;
    s.drive.listFiles = async () => { listings++; return [s.file]; };
    s.drive.download = async () => { started.resolve(); await release.promise; return s.body; };
    fetch = s.engine.fetchQuestionAttachments('q-a'); await started.promise;
    s.db.questions.put(question('a', 0)); sync = s.engine.syncNow();
    await turn(); assert.equal(listings, 1, 'pull must wait for explicit fetch to finish');
    release.resolve(); await fetch; await sync;
    assert.equal(s.repo.config().readOnly, true);
    assert.equal(s.repo.config().futureFiles?.future, 6);
    assert.equal(s.uploads.length, 0); assert.equal(s.events.includes('remove'), false);
  } finally { release.resolve(); await fetch; await sync; s.engine.dispose(); s.db.close(); }
});

test('explicit fetch locks on matching future metadata without downloading unknown body', async () => {
  const s = setup();
  try {
    s.file.appProperties.schema = '6'; s.drive.listFiles = async () => [s.file];
    assert.equal(await s.engine.fetchQuestionAttachments('q-a'), false);
    assert.equal(s.repo.config().readOnly, true);
    assert.equal(s.repo.config().futureFiles?.future, 6);
    assert.equal(s.events.includes('download'), false);
    s.db.questions.put(question('a', 0)); await s.engine.syncNow();
    assert.equal(s.uploads.length, 0); assert.equal(s.events.includes('remove'), false);
    assert.equal(s.events.includes('download'), false);
  } finally { s.engine.dispose(); s.db.close(); }
});

test('disable then reenable invalidates a queued fetch while text sync continues', async () => {
  const s = setup(), started = deferred<void>(), release = deferred<void>();
  let fetch: Promise<boolean> | undefined, sync: ReturnType<SyncEngine['syncNow']> | undefined;
  try {
    s.db.questions.put(question('a', 0));
    const upsert = s.drive.upsert;
    s.drive.upsert = async (...args) => { started.resolve(); await release.promise; return upsert(...args); };
    sync = s.engine.syncNow(); await started.promise;
    let listings = 0;
    s.drive.listFiles = async () => { listings++; return []; };
    fetch = s.engine.fetchQuestionAttachments('q-a');
    await s.engine.setImageSyncEnabled(false);
    assert.equal(s.repo.imageSyncEnabled(), false, 'disable must not wait behind the blocked text upload');
    await s.engine.setImageSyncEnabled(true);
    release.resolve(); await sync;
    assert.equal(await fetch, false); await s.engine.syncNow();
    assert.equal(listings, 0, 'obsolete queued fetch must not restart after reenable');
    assert.equal(s.uploads.length, 1);
  } finally { release.resolve(); await sync; await fetch; s.engine.dispose(); s.db.close(); }
});
