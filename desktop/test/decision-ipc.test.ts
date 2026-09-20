import assert from "node:assert/strict";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { transformSync } from "esbuild";
import { readSource } from "./fixtures";

test("decision IPC rejects untrusted callers for every handler, validates IDs and removes registrations",()=>{
  const handlers=new Map<string,(event:unknown,value:unknown)=>unknown>();
  const exported={exports:{} as {registerDecisionIpc:(options:unknown)=>()=>void}};
  const code=transformSync(readSource("src/main/decision-ipc.ts"),{loader:"ts",format:"cjs"}).code;
  runInNewContext(code,{module:exported,exports:exported.exports,require:(name:string)=>{
    assert.equal(name,"electron");
    return {ipcMain:{handle:(key:string,fn:(event:unknown,value:unknown)=>unknown)=>handlers.set(key,fn),removeHandler:(key:string)=>handlers.delete(key)}};
  }});
  let called=0;
  const decisions=new Proxy({},{get:()=>()=>{called++;return "ok";}});
  const dispose=exported.exports.registerDecisionIpc({decisions,trusted:(e:unknown)=>e===true});
  assert.equal(handlers.size,6);
  for(const fn of handlers.values())assert.throws(()=>fn(false,{}),/untrusted_sender/);
  assert.equal(called,0);
  assert.throws(()=>handlers.get("polyask:decision-get")!(true,""),/invalid_request/);
  assert.equal(handlers.get("polyask:decision-get")!(true,"one"),"ok");
  assert.equal(called,1);
  dispose();assert.equal(handlers.size,0);
});
