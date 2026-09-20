import assert from "node:assert/strict";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { transformSync } from "esbuild";
import { readSource } from "./fixtures";
import * as folderTypes from "../src/shared/task-folder";

test("folder IPC guards every handler, rejects malformed envelopes and disposes",()=>{
  const handlers=new Map<string,(event:unknown,value:unknown)=>unknown>();
  const exported={exports:{} as {registerTaskFolderIpc:(options:unknown)=>()=>void}};
  const code=transformSync(readSource("src/main/task-folder-ipc.ts"),{loader:"ts",format:"cjs"}).code;
  runInNewContext(code,{module:exported,exports:exported.exports,require:(name:string)=>{
    if(name==="../shared/task-folder")return folderTypes;
    assert.equal(name,"electron");
    return {ipcMain:{handle:(key:string,fn:(event:unknown,value:unknown)=>unknown)=>handlers.set(key,fn),removeHandler:(key:string)=>handlers.delete(key)}};
  }});
  let called=0;
  const folders=new Proxy({},{get:()=>()=>{called++;return "ok";}});
  const dispose=exported.exports.registerTaskFolderIpc({folders,trusted:(e:unknown)=>e===true});
  assert.equal(handlers.size,7);
  for(const fn of handlers.values())assert.throws(()=>fn(false,{}),/untrusted_sender/);
  assert.equal(called,0);
  for (const bad of [null,{},[],"",{id:"x"}])
    assert.throws(()=>handlers.get("polyask:folder-memberships-patch")!(true,bad),/invalid_request/);
  assert.throws(()=>handlers.get("polyask:folder-delete")!(true,""),/invalid_request/);
  assert.equal(handlers.get("polyask:folder-list")!(true,undefined),"ok");
  assert.equal(handlers.get("polyask:folder-memberships-patch")!(true,{target:{kind:"archive",id:"a"},changes:[]}),"ok");
  assert.equal(called,2);
  dispose();assert.equal(handlers.size,0);
});
