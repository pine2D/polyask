import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import { transformSync } from 'esbuild';
import { readSource } from './fixtures';
import { DesktopDatabase } from '../src/main/database';
import { SyncRepository } from '../src/main/sync-repository';
import { SyncPull } from '../src/main/sync-pull';
import * as syncTypes from '../src/shared/sync';
import { question } from './lib/question-attachment-fixtures';

for (const name of ['schema5-question-attachments.json','schema5-question-attachments-tombstone.json']) {
  test(`frozen ${name} imports through the production pull with original identity and payload`, async () => {
    const fixture=JSON.parse(readSource(`test/fixtures/${name}`));
    const db=DesktopDatabase.open(':memory:'),repo=new SyncRepository(db); db.meta.put('deviceId','fixture-device');
    try {
      repo.setImageSyncEnabled(true);
      await new SyncPull(repo,{listFiles:async()=>[fixture.file],getStartToken:async()=>'start',
        listChanges:async()=>({changes:[],newStartPageToken:'next'}),download:async()=>fixture.body},()=>100).run(new AbortController().signal);
      assert.equal(repo.config().readOnly,false); assert.equal(repo.config().errorCount,0);
      assert.deepEqual(repo.questionAttachments(fixture.body.id),fixture.body);
      assert.equal(repo.findDriveFile(`questionAttachments:${fixture.body.id}`)?.id,fixture.file.id);
    } finally {db.close();}
  });
}

test('frozen schema4 client implementation locks uploads when it encounters schema5', async () => {
  const exported={exports:{} as {SyncPull:typeof SyncPull}};
  runInNewContext(transformSync(readSource('test/fixtures/schema4-sync-pull.ts.txt'),{loader:'ts',format:'cjs'}).code,{
    module:exported,exports:exported.exports,require:(name:string)=>{
      if(name==='node:crypto')return {createHash};
      if(name==='../shared/sync')return {...syncTypes,SUPPORTED_SYNC_SCHEMA:4};
      if(name==='./sync-duplicates')return {convergeDuplicateFiles:async()=>{throw Error('must_not_delete');}};
      throw Error(`unexpected dependency: ${name}`);
    }
  });
  const fixture=JSON.parse(readSource('test/fixtures/schema5-question-attachments.json'));
  const db=DesktopDatabase.open(':memory:'),repo=new SyncRepository(db); db.meta.put('deviceId','fixture-device');
  try {
    db.questions.put(question());
    await new exported.exports.SyncPull(repo,{listFiles:async()=>[fixture.file],getStartToken:async()=>'start',
      listChanges:async()=>({changes:[],newStartPageToken:'next'}),download:async()=>{throw Error('must_not_download');}},()=>100).run(new AbortController().signal);
    assert.equal(repo.config().readOnly,true); assert.equal(repo.config().futureFiles?.[fixture.file.id],5);
    assert.equal(db.outbox.count(),1);
  } finally {db.close();}
});

test('local image flags match their fixture and are excluded from synchronized state and backup', () => {
  const fixture=JSON.parse(readSource('test/fixtures/image-sync-local-meta-v1.json'));
  const db=DesktopDatabase.open(':memory:'),repo=new SyncRepository(db); db.meta.put('deviceId','fixture-device');
  try {
    assert.equal(repo.imageSyncEnabled(),fixture.default.questionImageSyncEnabled);
    repo.setImageSyncEnabled(true);
    for(const [key,value] of Object.entries(fixture.confirmedEnable))assert.equal(db.meta.get(key),value);
    repo.setImageSyncEnabled(false);
    for(const [key,value] of Object.entries(fixture.disabledAfterEnable))assert.equal(db.meta.get(key),value);
    const state=JSON.stringify(repo.localStateFragment()),backup=JSON.stringify(db.businessSnapshot());
    for(const key of fixture.resetRemoves){assert.equal(state.includes(key),false);assert.equal(backup.includes(key),false);}
    const device=repo.deviceId(); db.resetLocalData(); assert.equal(repo.deviceId(),device);
    for(const key of fixture.resetRemoves)assert.equal(db.meta.get(key),null);
  } finally {db.close();}
});

test('a failed enable leaves the per-device flags and outbox unchanged', () => {
  const db=DesktopDatabase.open(':memory:'),repo=new SyncRepository(db); db.meta.put('deviceId','fixture-device');
  try {
    db.questionAttachments.all=()=>{throw Error('unreadable metadata');};
    assert.throws(()=>repo.setImageSyncEnabled(true));
    assert.equal(repo.imageSyncEnabled(),false,'failed enable cannot silently leave image sync on');
    assert.equal(db.meta.get('questionImageSyncAcknowledged'),null);
    assert.equal(db.outbox.count(),0);
  } finally {db.close();}
});
