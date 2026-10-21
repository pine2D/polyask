import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DesktopDatabase } from '../src/main/database';
import { SyncRepository } from '../src/main/sync-repository';
import { SyncEngine, type SyncDrive } from '../src/main/sync-engine';
import type { DriveFile } from '../src/main/drive-client';
import { SUPPORTED_SYNC_SCHEMA } from '../src/shared/sync';
import { image, question, wire } from './lib/question-attachment-fixtures';

function setup(db = DesktopDatabase.open(':memory:')) { db.meta.put('deviceId', 'device');
  const repo = new SyncRepository(db); repo.saveConfig({ connected: true });
  const files = new Map<string, {file: DriveFile; body: unknown}>();
  const uploaded: string[] = [], removed: string[] = [], downloaded: string[] = [];
  const drive: SyncDrive = {
    getStartToken: async () => 'token', listFiles: async () => [...files.values()].map(v => v.file),
    listChanges: async () => ({ changes: [], newStartPageToken: 'next' }),
    download: async id => { downloaded.push(id); return files.get(id)?.body; },
    upsert: async (id, name, appProperties, body) => {
      uploaded.push(appProperties.kind); const file = { id: id ?? `file-${files.size}`, name, appProperties };
      files.set(file.id, { file, body }); return file;
    }, remove: async id => { removed.push(id); files.delete(id); }, clearAll: async () => { files.clear(); }
  };
  const engine = new SyncEngine({ repository: repo, drive, auth: { configured: () => true, securePersistence: () => true,
    connect: async () => {}, disconnect: async () => {} } });
  const remote = (id: string, body = wire()) => {
    const file = { id, appProperties: { app: 'polyask', kind: 'questionAttachments', schema: '5', id: createHash('sha256').update(body.id).digest('hex'), deleted: 'deletedAt' in body ? '1' : '0' } };
    files.set(id, { file, body }); return file;
  };
  return { db, repo, files, uploaded, removed, downloaded, drive, engine, remote };
}

test('disabled originals stay queued without pending work or accidental schema5 publication', async () => {
  const s = setup();
  try {
    const q = question(); s.db.questions.put(q); s.db.questionAttachments.save(q, [image()]);
    await s.engine.syncNow();
    assert.deepEqual(s.uploaded, ['question']);
    assert.equal(s.repo.pending(), 0, 'disabled original rows must not count as pending');
    assert.equal(s.repo.nextAt(), null);
    assert.equal(s.db.outbox.count(), 1);
  } finally { s.engine.dispose(); s.db.close(); }
});

test('schema5 is recognized and indexed without downloading live bytes while disabled', async () => {
  const s = setup();
  try {
    s.remote('remote'); const status = await s.engine.syncNow();
    assert.equal(SUPPORTED_SYNC_SCHEMA, 5);
    assert.equal(status.readOnly, false);
    assert.equal(s.downloaded.length, 0);
    assert.equal(s.repo.driveFiles().length, 1);
  } finally { s.engine.dispose(); s.db.close(); }
});

async function enabled(s: ReturnType<typeof setup>) { await s.engine.setImageSyncEnabled(true); await s.engine.syncNow(); }
function pending<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }

test('enable replays disabled metadata after its changes token advanced; child waits for parent', async () => {
  const s = setup();
  try {
    const body = wire(); s.remote('remote', body); await s.engine.syncNow();
    await enabled(s);
    assert.equal(s.repo.imageSyncEnabled(), true);
    assert.equal(s.db.meta.get('questionImageSyncAcknowledged'), true);
    assert.equal(s.db.questionAttachments.get(body.id)?.id, body.id);
    assert.throws(() => s.db.questionAttachments.readAll(body.questionId));
    s.db.questions.put(question(), false);
    assert.equal(s.db.questionAttachments.readAll(body.questionId).length, 1);
    assert.equal(JSON.stringify(s.repo.localStateFragment()).includes('questionImageSync'), false);
    assert.equal(JSON.stringify(s.db.businessSnapshot()).includes('questionImageSync'), false);
  } finally { s.engine.dispose(); s.db.close(); }
});

test('never-enabled local tombstones stay local until remote evidence exists', async () => {
  const s = setup();
  try {
    const q = question(); s.db.questions.put(q); s.db.questionAttachments.save(q, [image()]);
    s.db.questions.put({ schema: 4, id: q.id, createdAt: q.createdAt, updatedAt: 20, deletedAt: 20, deviceId: q.deviceId });
    await s.engine.syncNow();
    assert.deepEqual(s.uploaded, ['question']); assert.equal(s.repo.pending(), 0);
    const file = s.remote('remote'); s.drive.listChanges = async () => ({ changes: [{file}], newStartPageToken: 'third' });
    await s.engine.syncNow();
    assert.equal(s.uploaded.includes('questionAttachments'), true);
    assert.equal('deletedAt' in (s.files.get('remote')!.body as object), true);
  } finally { s.engine.dispose(); s.db.close(); }
});

test('parent failure and pagination never allow its live child to upload first', async () => {
  const s = setup();
  try {
    for (let i = 0; i < 105; i++) { const q = question(`q-${i}`); s.db.questions.put(q); s.db.questionAttachments.save(q, [image()]); }
    const upsert = s.drive.upsert; let failures = 0;
    s.drive.upsert = async (id, name, props, body, signal) => {
      if (props.kind === 'question' && (body as {id: string}).id === 'q-0') { failures++; throw Object.assign(new Error('request_failed'), {code: 'request_failed'}); }
      if (props.kind === 'questionAttachments') {
        const qid = (body as {questionId: string}).questionId;
        assert.equal([...s.files.values()].some(v => (v.body as {id?: string}).id === qid), true, 'parent must exist remotely before child');
      }
      return upsert(id, name, props, body, signal);
    };
    await enabled(s);
    assert.equal(failures, 1); assert.equal(s.uploaded.filter(k => k === 'questionAttachments').length, 104);
    assert.equal(s.db.outbox.count(), 2);
  } finally { s.engine.dispose(); s.db.close(); }
});

test('disable aborts pending upload immediately, retains its queue and continues text', async () => {
  const s = setup(), started = pending<void>(), delayed = pending<DriveFile>();
  try {
    const q = question(); s.db.questions.put(q); s.db.questionAttachments.save(q, [image()]);
    let imageSignal: AbortSignal | undefined; const upsert = s.drive.upsert;
    s.drive.upsert = async (id, name, props, body, signal) => {
      if (props.kind === 'questionAttachments') { imageSignal = signal; started.resolve(); return delayed.promise; }
      return upsert(id, name, props, body, signal);
    };
    await s.engine.setImageSyncEnabled(true); await started.promise;
    const next = question('later', 0); s.db.questions.put(next);
    await s.engine.setImageSyncEnabled(false); await s.engine.syncNow();
    assert.equal(imageSignal?.aborted, true);
    assert.equal(s.uploaded.filter(k => k === 'question').length, 2);
    assert.equal(s.db.outbox.count(), 1); assert.equal(s.repo.pending(), 0);
    delayed.resolve({ id: 'late-upload' }); await Promise.resolve(); await Promise.resolve();
    assert.equal(s.repo.driveFile('late-upload') === null, true);
    assert.equal(s.db.outbox.count(), 1);
  } finally { s.engine.dispose(); s.db.close(); }
});

test('disable, parent deletion and reset reject delayed image download commits', async () => {
  for (const stop of ['disable', 'delete', 'reset', 'disconnect'] as const) {
    const s = setup(), started = pending<void>(), delayed = pending<unknown>();
    try {
      const q = question(); s.db.questions.put(q, false); s.remote('remote');
      let imageSignal: AbortSignal | undefined;
      s.drive.download = async (_id, signal) => { imageSignal = signal; started.resolve(); return delayed.promise; };
      await s.engine.setImageSyncEnabled(true); await started.promise;
      let disconnect: Promise<unknown> | undefined;
      if (stop === 'disable') await s.engine.setImageSyncEnabled(false);
      if (stop === 'delete') s.db.questions.put({schema:4, id:q.id, createdAt:q.createdAt, updatedAt:20, deletedAt:20, deviceId:q.deviceId});
      if (stop === 'reset') s.db.resetLocalData();
      if (stop === 'disconnect') disconnect = s.engine.disconnect();
      delayed.resolve(wire()); await disconnect; await s.engine.syncNow();
      if (stop === 'disable' || stop === 'disconnect') assert.equal(imageSignal?.aborted, true);
      assert.throws(() => s.db.questionAttachments.readAll(q.id), stop);
      if (stop === 'reset') assert.equal(s.db.questionAttachments.all().length, 0);
    } finally { s.engine.dispose(); s.db.close(); }
  }
});

test('disabled duplicates are not deleted; enabling verifies and converges lost-response copies', async () => {
  const s = setup();
  try {
    s.remote('z'); s.remote('a'); await s.engine.syncNow(); assert.equal(s.removed.length, 0);
    const q = question(); s.db.questions.put(q); await enabled(s);
    assert.deepEqual(s.removed, ['z']); assert.equal(s.files.has('a'), true);
    const attachment = [...s.files.values()].find(v => v.file.appProperties?.kind === 'questionAttachments')!;
    const props = attachment.file.appProperties!;
    assert.deepEqual(Object.keys(props).sort(), ['app', 'deleted', 'id', 'kind', 'schema']);
    assert.equal(attachment.file.name, `questionAttachments-${props.id}.json`);
    assert.equal(JSON.stringify(props).includes('original.png'), false);
  } finally { s.engine.dispose(); s.db.close(); }
});

test('upgrade releases schema5 metadata locks without bytes, while schema6 stays locked', async () => {
  const s = setup();
  try {
    s.remote('v5'); s.repo.saveConfig({readOnly:true, pageToken:'old', futureFiles:{v5:5}});
    await s.engine.syncNow(); assert.equal(s.repo.config().readOnly, false); assert.equal(s.downloaded.length, 0);
    const file = {id:'v6', appProperties:{app:'polyask', kind:'questionAttachments', schema:'6', id:'x'}};
    s.drive.listChanges = async () => ({changes:[{file}],newStartPageToken:'six'});
    s.db.questions.put(question()); await s.engine.syncNow();
    assert.equal(s.repo.config().readOnly, true); assert.equal(s.uploaded.length, 0);
  } finally { s.engine.dispose(); s.db.close(); }
});

test('one corrupt local attachment cannot prevent other eligible records from uploading', async () => {
  const s = setup();
  try {
    const q = question(); s.db.questions.put(q); s.db.questionAttachments.save(q, [image()]);
    const original = s.repo.questionAttachments.bind(s.repo); s.repo.questionAttachments = id => {
      if (id === wire().id) throw new Error('invalid_question_attachments'); return original(id);
    };
    const good = question('good'); s.db.questions.put(good); s.db.questionAttachments.save(good, [image()]);
    await enabled(s);
    assert.equal(s.uploaded.filter(k => k === 'questionAttachments').length, 1, 'failed original is isolated');
    assert.equal(s.db.outbox.count(), 1);
  } finally { s.engine.dispose(); s.db.close(); }
});

test('a future body schema behind old metadata keeps global uploads read-only', async () => {
  const s = setup();
  try {
    s.remote('future'); s.files.get('future')!.body = {...wire(), schema:6};
    s.db.questions.put(question()); await enabled(s);
    assert.equal(s.repo.config().readOnly, true, 'unknown body format must lock all uploads');
    assert.equal(s.uploaded.length, 0);
  } finally { s.engine.dispose(); s.db.close(); }
});

test('explicit fetch does not require an active sync run and never enables images implicitly', async () => {
  const s = setup();
  try {
    const q = question(); s.db.questions.put(q, false); s.remote('remote');
    assert.equal(await s.engine.fetchQuestionAttachments(q.id), false);
    assert.equal(s.downloaded.length, 0);
    s.repo.setImageSyncEnabled(true);
    for (const id of ['missing', '../../file.png', 'https://example.com']) assert.equal(await s.engine.fetchQuestionAttachments(id), false);
    assert.equal(await s.engine.fetchQuestionAttachments(q.id), true);
    assert.deepEqual(s.db.questionAttachments.readAll(q.id), [image()]);
    s.repo.saveConfig({connected:false});
    assert.equal(await s.engine.fetchQuestionAttachments(q.id), false);
    assert.equal(s.repo.imageSyncEnabled(), true);
    s.db.resetLocalData();
    assert.equal(s.repo.imageSyncEnabled(), false);
    assert.equal(s.db.meta.get('questionImageSyncAcknowledged') === null, true);
  } finally { s.engine.dispose(); s.db.close(); }
});

test('remote attachment failure is isolated, but account authorization and quota remain global', async () => {
  for (const code of ['network_timeout','unauthorized','forbidden','rate_limited']) {
    const s = setup();
    try {
      s.remote('remote'); s.db.questions.put(question('local',0)); s.repo.setImageSyncEnabled(true);
      s.drive.download = async () => {throw Object.assign(new Error(code),{code});};
      const status = await s.engine.syncNow();
      if (code === 'network_timeout') {
        assert.deepEqual(s.uploaded,['question']); assert.equal(status.errorCount,1);
      } else {
        assert.equal(s.uploaded.length,0);
        assert.equal(status.state,code === 'unauthorized' ? 'auth' : code === 'forbidden' ? 'blocked' : 'waiting');
      }
    } finally { s.engine.dispose(); s.db.close(); }
  }
});

test('clearing remote data includes schema5 originals and disconnects without deleting local images', async () => {
  const s = setup();
  try {
    const q=question(); s.db.questions.put(q); s.db.questionAttachments.save(q,[image()]); await enabled(s);
    assert.equal([...s.files.values()].some(v=>v.file.appProperties?.schema === '5'),true);
    const status=await s.engine.clearRemote();
    assert.equal(s.files.size,0); assert.equal(status.connected,false);
    assert.equal(s.db.questionAttachments.readAll(q.id).length,1);
  } finally { s.engine.dispose(); s.db.close(); }
});

test('a known future6 body stays locked when image sync is subsequently disabled', async () => {
  const s = setup();
  try {
    const file=s.remote('future'); s.repo.saveConfig({readOnly:true,futureFiles:{future:6},pageToken:'cursor'});
    s.drive.listChanges=async()=>({changes:[{file}],newStartPageToken:'later'});
    await s.engine.syncNow(); assert.equal(s.repo.config().readOnly,true);
    assert.equal(s.repo.config().futureFiles?.future,6); assert.equal(s.downloaded.length,0);
  } finally { s.engine.dispose(); s.db.close(); }
});

test('explicit fetch repairs same-version damaged BLOBs without replacing immutable image metadata', async () => {
  const dir=mkdtempSync(join(tmpdir(),'polyask-image-sync-')),path=join(dir,'data.sqlite');
  const s=setup(DesktopDatabase.open(path)),raw=new DatabaseSync(path);
  try {
    const q=question();s.db.questions.put(q,false);s.db.questionAttachments.save(q,[image()]);s.repo.setImageSyncEnabled(true);s.remote('remote');
    raw.prepare('UPDATE question_attachment_items SET data=?').run(Buffer.from('corrupt'));
    assert.throws(()=>s.db.questionAttachments.readAll(q.id));
    assert.equal(await s.engine.fetchQuestionAttachments(q.id),true);
    assert.deepEqual(s.db.questionAttachments.readAll(q.id),[image()]);
    s.files.get('remote')!.body=wire(q.id,[image('different.png')]);
    assert.equal(await s.engine.fetchQuestionAttachments(q.id),true,'existing complete originals remain available after a conflicting remote record');
    assert.equal(s.db.questionAttachments.readAll(q.id)[0].name,'original.png');
  } finally {s.engine.dispose();raw.close();s.db.close();rmSync(dir,{recursive:true,force:true});}
});

test('unreadable local attachment metadata is isolated from status and other upload batches', async () => {
  const s=setup();
  try {
    for(const id of ['q-a','good']){const q=question(id);s.db.questions.put(q);s.db.questionAttachments.save(q,[image()]);}
    s.repo.setImageSyncEnabled(true);
    const get=s.db.questionAttachments.get.bind(s.db.questionAttachments);
    s.db.questionAttachments.get=id=>{if(id===wire().id)throw Error('invalid_question_attachments');return get(id);};
    let count = -1;
    await assert.doesNotReject(async () => { count = (await s.engine.syncNow()).pending; }, "one invalid manifest must not break sync status");
    assert.equal(count,1);
    assert.equal(s.uploaded.filter(kind=>kind==='questionAttachments').length,1);
  } finally {s.engine.dispose();s.db.close();}
});
