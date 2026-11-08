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

test('decision IPC forwards explicit schema6 provenance and rejects omitted or stale versions without writes',async()=>{
  const {DesktopDatabase}=await import('../src/main/database');
  const {ArchiveService}=await import('../src/main/archive-service');
  const {DecisionService}=await import('../src/main/decision-service');
  const db=DesktopDatabase.open(':memory:');db.meta.put('deviceId','local');
  const archives=new ArchiveService(db.archives,{deviceId:()=> 'local',now:()=>100,createId:()=> 'source'});
  const source=archives.add({text:'Question',task:'Question',results:[{host:'claude.ai',label:'Claude',text:'First. Second.'}]});
  const decisions=new DecisionService(db.decisions,archives,{deviceId:()=> 'local',now:()=>200,createId:()=> 'card'});
  const input={archiveId:source.id,sourceUpdatedAt:100,title:'Card',conclusion:'',rationale:'',uncertainties:'',nextStep:'',status:'draft',
    evidence:[{id:'quote',topic:'Cost',resultIndex:0,excerpt:'First.'}]};
  const card=decisions.create(input);
  const handlers=new Map<string,(event:unknown,value:unknown)=>unknown>();
  const exported={exports:{} as {registerDecisionIpc:(options:unknown)=>()=>void}};
  runInNewContext(transformSync(readSource('src/main/decision-ipc.ts'),{loader:'ts',format:'cjs'}).code,
    {module:exported,exports:exported.exports,require:()=>({ipcMain:{handle:(key:string,fn:any)=>handlers.set(key,fn),removeHandler:(key:string)=>handlers.delete(key)}})});
  const dispose=exported.exports.registerDecisionIpc({decisions,trusted:()=>true});
  try {
    db.archives.put({...source,updatedAt:101});
    const pending=db.outbox.ready(Number.MAX_SAFE_INTEGER), update=handlers.get('polyask:decision-update')!;
    const {sourceUpdatedAt:ignored,...omitted}=input;
    assert.throws(()=>update(true,{id:card.id,input:omitted}),/invalid_decision/);
    assert.throws(()=>update(true,{id:card.id,input}),/decision_source_changed/);
    assert.deepEqual(decisions.get(card.id),card);assert.deepEqual(db.outbox.ready(Number.MAX_SAFE_INTEGER),pending);
    update(true,{id:card.id,input:{...input,sourceUpdatedAt:101,evidence:[{...input.evidence[0],excerpt:'Second.'}]}});
    assert.equal(decisions.get(card.id)!.sourceUpdatedAt,101);assert.equal(decisions.get(card.id)!.evidence[0].excerpt,'Second.');
  } finally {dispose();db.close();}
});
