import assert from 'node:assert/strict';
import test from 'node:test';
import {runInNewContext} from 'node:vm';
import {transformSync} from 'esbuild';
import {readSource} from './fixtures';

test('data counts use the trusted shell, perform no mutation and dispose their handler',async()=>{
  const handlers=new Map<string,(event:unknown,value?:unknown)=>unknown>();
  const exported={exports:{} as {registerDataAdminIpc:(options:unknown)=>()=>void}};
  runInNewContext(transformSync(readSource('src/main/data-admin-ipc.ts'),{loader:'ts',format:'cjs'}).code,{
    module:exported,exports:exported.exports,require:(name:string)=>{
      assert.equal(name,'electron');return {ipcMain:{handle:(key:string,fn:any)=>handlers.set(key,fn),removeHandler:(key:string)=>handlers.delete(key)}};
    }});
  let reads=0,writes=0,events=0;const stats={history:132};
  const admin=new Proxy({},{get:(_target,key)=>key==='stats'?()=>{reads++;return stats;}:()=>{writes++;}});
  const dispose=exported.exports.registerDataAdminIpc({admin,trusted:(value:unknown)=>value===true,
    afterHistoryChange:()=>events++,afterReset:()=>events++});
  assert.ok(handlers.has('polyask:local-data-stats'),'counts handler must be registered');
  for(const handler of handlers.values())await assert.rejects(Promise.resolve().then(()=>handler(false)),/untrusted_sender/);
  assert.equal(reads+writes+events,0);
  assert.equal(handlers.get('polyask:local-data-stats')!(true),stats);
  assert.equal(reads,1);assert.equal(writes+events,0);
  dispose();assert.equal(handlers.size,0);
});
