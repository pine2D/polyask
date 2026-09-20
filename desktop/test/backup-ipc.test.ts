import assert from "node:assert/strict";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { transformSync } from "esbuild";
import { readSource } from "./fixtures";
import * as path from "node:path";

test("backup IPC uses native paths only, guards trust, handles cancel, and publishes after apply",async()=>{
  const handlers=new Map<string,(event:unknown,value?:unknown)=>Promise<unknown>>();
  const exported={exports:{} as {registerBackupIpc:(options:unknown)=>()=>void}};
  let cancelled=true,reads=0,writes=0,applies=0,published=0;
  let waitForOpen: Promise<void> | null = null;
  const code=transformSync(readSource("src/main/backup-ipc.ts"),{loader:"ts",format:"cjs"}).code;
  runInNewContext(code,{module:exported,exports:exported.exports,Date,require:(name:string)=>{
    if(name==="node:path")return path;
    if(name==="electron")return {ipcMain:{handle:(key:string,fn:any)=>handlers.set(key,fn),removeHandler:(key:string)=>handlers.delete(key)},dialog:{
      showOpenDialog:async()=>{ await waitForOpen; return {canceled:cancelled,filePaths:["/chosen/backup.json"]}; },
      showSaveDialog:async()=>({canceled:cancelled,filePath:"/chosen/export.json"})
    }};
    assert.equal(name,"./backup-files");
    return {readBackupFile:async(path:string)=>{assert.equal(path,"/chosen/backup.json");reads++;return {valid:true};},writeBackupFile:async(path:string)=>{assert.equal(path,"/chosen/export.json");writes++;}};
  }});
  const backup={export:()=>({format:"polyask-backup"}),preview:()=>({token:"preview"}),apply:()=>{applies++;return {imported:1,skipped:0};},cancel:()=>{}};
  const dispose=exported.exports.registerBackupIpc({window:{},backup,trusted:(e:unknown)=>e===true,afterApply:()=>{published++;}});
  assert.equal(handlers.size,4);
  for(const fn of handlers.values())await assert.rejects(fn(false,{}),/untrusted_sender/);
  assert.equal(await handlers.get("polyask:backup-preview")!(true,{path:"/untrusted"}),null);
  assert.equal(await handlers.get("polyask:backup-export")!(true),false);
  assert.equal(reads+writes,0);
  cancelled=false;
  const preview=await handlers.get("polyask:backup-preview")!(true,{path:"/untrusted"}) as any;
  assert.equal(preview.token,"preview");assert.equal(preview.filename,"backup.json");
  assert.equal(await handlers.get("polyask:backup-export")!(true),true);
  assert.equal(reads+writes,2);
  await assert.rejects(handlers.get("polyask:backup-apply")!(true,{token:[],selectedKeys:[]}),/invalid_request/);
  await handlers.get("polyask:backup-apply")!(true,{token:"preview",selectedKeys:["archive:a"]});
  assert.equal(applies,1);assert.equal(published,1);
  let resolveOpen!: () => void;
  waitForOpen=new Promise<void>((resolve)=>{resolveOpen=resolve;});
  const pendingPreview=handlers.get("polyask:backup-preview")!(true);
  await assert.rejects(handlers.get("polyask:backup-apply")!(true,{token:"preview",selectedKeys:[]}),/backup_busy/);
  dispose();assert.equal(handlers.size,0);
  resolveOpen();
  assert.equal(await pendingPreview,null);
  assert.equal(reads,1,"closing the window while the native dialog is open must not read a file");
});
