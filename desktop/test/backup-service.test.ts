import assert from "node:assert/strict";
import { test } from "node:test";
import { DesktopDatabase } from "../src/main/database";
import { BackupService } from "../src/main/backup-service";
const template = (text="backup") => ({kind:"template" as const,id:"t",body:{id:"t",name:"Template",text,updatedAt:10}});
const doc = (entries: any[] = [template()]) => ({format:"polyask-backup",version:1,exportedAt:20,entries});
const setup = () => { const db=DesktopDatabase.open(":memory:"); return {db,service:new BackupService(db,{deviceId:()=>"local",now:()=>100})}; };
test("backup applies only selected versions and repeated import is unchanged",()=>{
 const {db,service}=setup(); try {
 db.state.put("template:t",{...template("local").body,deviceId:"local"},10,false);
 const p=service.preview(doc()); assert.equal(p.items[0].status,"conflict");
 assert.deepEqual(service.apply(p.token,[]),{imported:0,skipped:1}); assert.equal(db.outbox.count(),0);
 const q=service.preview(doc()); service.apply(q.token,[q.items[0].key]);
 assert.equal(db.state.get<any>("template:t").text,"backup"); assert.equal(db.outbox.count(),1);
 assert.equal(service.preview(doc()).items[0].status,"same");
 } finally {db.close();}
});
test("backup rejects duplicates, unknown kinds and stale confirmations without mutation",()=>{
 const {db,service}=setup(); try {
 assert.throws(()=>service.preview(doc([template(),template()])),/backup_invalid/);
 assert.throws(()=>service.preview(doc([{kind:"meta",id:"oauth",body:{}}])),/backup_invalid/);
 const p=service.preview(doc()); db.state.put("workspace",{selectedSites:[],tier:null,updatedAt:40,deviceId:"local"},40,false);
 assert.throws(()=>service.apply(p.token,[p.items[0].key]),/backup_stale/); assert.equal(db.state.get("template:t"),null);
 } finally {db.close();}
});

test("backup previews missing dependencies as blocked and leaves no orphan links",()=>{
 const {db,service}=setup(); try {
 const entry={kind:"folderMembership",id:"1:f:archive:a",body:{id:"1:f:archive:a",folderId:"f",targetKind:"archive",targetId:"a",schema:3,createdAt:1,updatedAt:1}};
 const p=service.preview(doc([entry])); assert.equal(p.items[0].blocked,true);
 assert.deepEqual(service.apply(p.token,[p.items[0].key]),{imported:0,skipped:1});
 assert.equal(db.outbox.count(),0);
 } finally {db.close();}
});

test("backup strips nested unknown fields and never exports private state or device identity",()=>{
 const {db,service}=setup(); try {
 db.meta.put("deviceId","secret-device"); db.meta.put("syncConfig",{refreshToken:"secret"});
 db.state.put("secret",{password:"secret"},1,false);
 db.state.put("template:t",{...template().body,deviceId:"secret-device",oauth:{token:"secret"}},10,false);
 const exported=service.export(); assert.equal(exported.entries.length,1);
 assert.equal(JSON.stringify(exported).includes("secret"),false);
 const p=service.preview(doc([{...template(),body:{...template("updated").body,deviceId:"attacker",oauth:{token:"secret"}}}]));
 service.apply(p.token,[p.items[0].key]);
 assert.equal(db.state.get<any>("template:t").deviceId,"local");
 assert.equal(db.state.get<any>("template:t").oauth,undefined);
 assert.equal(db.meta.get("deviceId"),"secret-device");
 } finally {db.close();}
});

test("backup rolls records and outbox back together if a later selected write fails",()=>{
 const {db,service}=setup(); try {
 const p=service.preview(doc([template(),{...template(),id:"u",body:{...template().body,id:"u"}}]));
 const original=db.state.put.bind(db.state); let calls=0;
 db.state.put=((...args:Parameters<typeof db.state.put>)=>{if(++calls===2) throw new Error("disk_failed");return original(...args);}) as typeof db.state.put;
 assert.throws(()=>service.apply(p.token,p.items.map(i=>i.key)),/disk_failed/);
 assert.equal(db.state.get("template:t"),null); assert.equal(db.outbox.count(),0);
 db.state.put=original; assert.equal(service.apply(p.token,p.items.map(i=>i.key)).imported,2);
 } finally {db.close();}
});

test("deleted folder restore uses one stable identity, retains later edits and maps only selected links",()=>{
 const {db,service}=setup(); try {
 const folder={kind:"folder",id:"f",body:{id:"f",name:"Old",createdAt:1,updatedAt:2,schema:3}};
 db.folders.put({id:"f",createdAt:1,updatedAt:4,deletedAt:4,deviceId:"local",schema:3},false);
 const p=service.preview(doc([folder])); assert.equal(p.items[0].status,"deleted");assert.equal(p.items[0].note,"folder_new_identity");
 assert.equal(service.apply(p.token,[]).imported,0); assert.equal(db.folders.list().length,0);
 const q=service.preview(doc([folder])); service.apply(q.token,[q.items[0].key]);
 const restored=db.folders.list()[0]; assert.notEqual(restored.id,"f");
 db.folders.put({...restored,name:"Locally edited",updatedAt:200});
 const r=service.preview(doc([folder])); assert.equal(service.apply(r.token,[r.items[0].key]).imported,0);
 assert.equal(db.folders.list().length,1);assert.equal(db.folders.list()[0].name,"Locally edited");
 db.folders.delete(restored.id,300,"local");
 const t=service.preview(doc([folder]));assert.equal(t.items[0].blocked,true);
 } finally {db.close();}
});

test("backup preview exposes required selected dependencies for links",()=>{
 const {db,service}=setup(); try {
 const folder={kind:"folder",id:"f",body:{id:"f",name:"Folder",createdAt:1,updatedAt:2,schema:3}};
 const member={kind:"folderMembership",id:"1:f:archive:a",body:{id:"1:f:archive:a",folderId:"f",targetKind:"archive",targetId:"a",schema:3,createdAt:1,updatedAt:1}};
 const p=service.preview(doc([folder,member])); assert.deepEqual(p.items[1].requires,["folder:f","archive:a"]);
 } finally {db.close();}
});

test("reimport respects the tombstone of a remapped membership instead of treating it as new",()=>{
 const {db,service}=setup(); try {
 const folder={kind:"folder",id:"f",body:{id:"f",name:"Folder",createdAt:1,updatedAt:2,schema:3}};
 const decision={kind:"decision",id:"d",body:{id:"d",archiveId:"a",title:"Decision",sourceTitle:"Question",conclusion:"",rationale:"",uncertainties:"",nextStep:"",status:"draft",evidence:[],createdAt:1,updatedAt:2,schema:2}};
 const member={kind:"folderMembership",id:"1:f:decision:d",body:{id:"1:f:decision:d",folderId:"f",targetKind:"decision",targetId:"d",createdAt:1,updatedAt:2,schema:3}};
 db.folders.put({id:"f",createdAt:1,updatedAt:3,deletedAt:3,deviceId:"local",schema:3},false);
 const backup=doc([folder,decision,member]);const first=service.preview(backup);
 assert.equal(service.apply(first.token,first.items.map(i=>i.key)).imported,3);
 const mapped=db.folders.listMemberships()[0];
 db.folders.putMembership({...mapped,deletedAt:200,updatedAt:200,deviceId:"local"},false);
 const again=service.preview(backup),item=again.items.find(i=>i.kind==="folderMembership")!;
 assert.equal(item.status,"deleted");assert.deepEqual(item.local,{deletedAt:200});
 const defaults=again.items.filter(i=>i.status==="new").map(i=>i.key);
 assert.equal(service.apply(again.token,["folder:f",...defaults]).imported,0);
 assert.ok("deletedAt" in db.folders.getMembership(mapped.id)!);
 const explicit=service.preview(backup);
 assert.equal(service.apply(explicit.token,["folder:f",item.key]).imported,1);
 assert.equal("deletedAt" in db.folders.getMembership(mapped.id)!,false);
 const last=service.preview(backup);assert.equal(last.items.find(i=>i.kind==="folderMembership")!.status,"same");
 } finally {db.close();}
});
