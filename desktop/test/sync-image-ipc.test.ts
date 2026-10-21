import assert from 'node:assert/strict';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { transformSync } from 'esbuild';
import { readSource } from './fixtures';
import * as syncTypes from '../src/shared/sync';
import * as historyTypes from '../src/shared/question-history';

test('image sync IPC trusts only shell, confirms enabling and accepts only question IDs for fetch', async () => {
  const handlers = new Map<string, (...args: unknown[]) => any>();
  const exported = {exports:{} as {registerSyncIpc(options: unknown): () => void}};
  runInNewContext(transformSync(readSource('src/main/sync-ipc.ts'), {loader:'ts',format:'cjs'}).code, {
    Error, module:exported,exports:exported.exports,require:(name: string) => {
      if (name === '../shared/sync') return syncTypes;
      if (name === '../shared/question-history') return historyTypes;
      assert.equal(name, 'electron'); return {ipcMain:{handle:(key: string, action: any) => handlers.set(key,action), removeHandler:(key: string) => handlers.delete(key)}};
    }
  });
  const settings: boolean[] = [], fetched: string[] = [];
  const dispose = exported.exports.registerSyncIpc({trusted:(event:unknown) => event === 'shell',runtime:{},sync:{
    setImageSyncEnabled:async (enabled:boolean) => {settings.push(enabled);return {imageSyncEnabled:enabled};},
    fetchQuestionAttachments:async (id:string) => {fetched.push(id);return true;}
  }});
  try {
    const set = handlers.get('polyask:sync-images')!, fetch = handlers.get('polyask:question-fetch-attachments')!;
    assert.equal(typeof set, 'function'); assert.equal(typeof fetch, 'function');
    assert.throws(() => set('site',true,true), /untrusted_sender/);
    assert.throws(() => fetch('site','q-a'), /untrusted_sender/);
    for (const value of [null, 1, 'true', {}, undefined]) assert.throws(() => set('shell',value,true), /invalid_image_sync_setting/);
    assert.throws(() => set('shell',true,false), /invalid_image_sync_setting/);
    for (const value of [{questionId:'q-a'}, '', '\x00', 'x'.repeat(129), null]) assert.throws(() => fetch('shell',value), /invalid_question/);
    assert.equal((await set('shell',true,true)).imageSyncEnabled, true);
    assert.equal((await set('shell',false)).imageSyncEnabled, false);
    assert.equal(await fetch('shell','q-a'), true);
    assert.deepEqual(settings,[true,false]); assert.deepEqual(fetched,['q-a']);
  } finally { dispose(); assert.equal(handlers.size,0); }
});
