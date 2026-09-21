import assert from "node:assert/strict";
import {test} from "node:test";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {createHash} from "node:crypto";
import {DesktopDatabase} from "../src/main/database";
import {BackupService} from "../src/main/backup-service";
import {createArchiveRecord} from "../src/shared/archive";
import {folderMembershipId} from "../src/shared/task-folder";
import {BACKUP_MAX_BYTES} from "../src/shared/backup";
const fixture = (name:string) => JSON.parse(readFileSync(join(__dirname,"fixtures",name),"utf8"));
const wrap = (entries:any[]) => ({format:"polyask-backup",version:1,exportedAt:500,entries});
const withoutDevice = (v:any) => {const {deviceId,...rest}=v;return rest;};
test("backup round trips all eight kinds and remaps a deleted folder membership in any entry order",()=>{
 const db=DesktopDatabase.open(":memory:"),target=DesktopDatabase.open(":memory:");
 try {
 const a=createArchiveRecord({text:"Question",task:"Question",results:[]},{id:"archive-a",now:100,deviceId:"source"});
 db.archives.put(a,false);db.decisions.put(fixture("schema2-decision.json").body,false);
 const history=fixture("schema1-history.json").body;db.history.put(history,false);
 db.folders.put({id:"f",name:"Folder",createdAt:1,updatedAt:2,deviceId:"source",schema:3},false);
 const id=folderMembershipId({kind:"archive",id:a.id},"f");
 db.folders.putMembership({id,folderId:"f",targetKind:"archive",targetId:a.id,createdAt:1,updatedAt:2,deviceId:"source",schema:3},false);
 db.state.put("template:t",{id:"t",name:"Template",text:"Question",updatedAt:10,deviceId:"source"},10,false);
 db.state.put("group:g",{id:"g",name:"Group",sites:["chatgpt"],updatedAt:10,deviceId:"source"},10,false);
 db.state.put("workspace",{selectedSites:["chatgpt"],tier:"fast",updatedAt:10,deviceId:"source"},10,false);
 const source=new BackupService(db,{deviceId:()=>"source",now:()=>500});const backup=source.export();assert.equal(backup.entries.length,8);
 target.folders.put({id:"f",createdAt:1,updatedAt:3,deletedAt:3,deviceId:"target",schema:3},false);
 const service=new BackupService(target,{deviceId:()=>"target",now:()=>600});
 const p=service.preview({...backup,entries:[...backup.entries].reverse()});
 assert.equal(service.apply(p.token,p.items.map(i=>i.key)).imported,8);
 const folder=target.folders.list()[0];assert.notEqual(folder.id,"f");
 assert.equal(target.folders.listMemberships()[0].folderId,folder.id);
 assert.equal(target.outbox.count(),8);
 assert.equal(service.export().entries.length,8);
 } finally {db.close();target.close();}
});
test("backup includes more than the history screen limit and ignores tombstones",()=>{
 const db=DesktopDatabase.open(":memory:");try {
 for(let n=0;n<105;n++) {const text=`q${n}`,id=createHash("sha256").update(text).digest("hex");db.history.put({id,textHash:id,text,preview:text,createdAt:1,lastUsedAt:1,updatedAt:1,deviceId:"local",schema:1},false);}
 const first=db.history.list()[0];db.history.delete(first.id,2,"local");
 const service=new BackupService(db,{deviceId:()=>"local"});assert.equal(service.export().entries.length,104);
 } finally {db.close();}
});
test("backup validates size, count, malformed data, selected keys and cancellation",()=>{
 const db=DesktopDatabase.open(":memory:");try {
 const service=new BackupService(db,{deviceId:()=>"local"});
 assert.throws(()=>service.preview({...wrap([]),version:3}),/backup_version/);
 assert.throws(()=>service.preview(wrap(Array.from({length:20001},()=>({})))),/backup_invalid/);
 assert.throws(()=>service.preview({...wrap([]),padding:"x".repeat(BACKUP_MAX_BYTES)}),/backup_too_large/);
 assert.throws(()=>service.preview(wrap([{kind:"workspace",id:"workspace",body:{selectedSites:["future"],tier:null,updatedAt:1}}])),/backup_invalid/);
 const p=service.preview(wrap([]));assert.throws(()=>service.apply(p.token,["invalid"]),/backup_selection/);
 service.cancel(p.token);assert.throws(()=>service.apply(p.token,[]),/backup_missing/);assert.equal(db.outbox.count(),0);
 } finally {db.close();}
});
test("backup rejects primitive fields carrying nested injected objects",()=>{
 const db=DesktopDatabase.open(":memory:");try {
 const service=new BackupService(db,{deviceId:()=>"local"});
 const a=createArchiveRecord({text:"Q",task:"Q",results:[{host:"[object Object]",label:"A",text:"Answer"}]},{id:"a",now:1,deviceId:"local"});
 const body={...withoutDevice(a),results:[{host:{oauth:"secret"},label:"A",text:"Answer"}]};
 assert.throws(()=>service.preview(wrap([{kind:"archive",id:"a",body}])),/backup_invalid/);
 } finally {db.close();}
});
test("restored history version wins over a later local lastUsedAt",()=>{
 const db=DesktopDatabase.open(":memory:");try {
 const h=fixture("schema1-history.json").body;
 db.history.put({...h,updatedAt:10,lastUsedAt:9_000_000_000_000,deletedAt:20},false);
 const service=new BackupService(db,{deviceId:()=>"local",now:()=>100});
 const p=service.preview(wrap([{kind:"history",id:h.id,body:withoutDevice(h)}]));service.apply(p.token,[p.items[0].key]);
 assert.ok(db.history.get(h.id)!.updatedAt>9_000_000_000_000);
 } finally {db.close();}
});
test("frozen backup format 1 imports all eight business kinds without changing identity",()=>{
 const db=DesktopDatabase.open(":memory:");try {
 db.meta.put("deviceId","existing-device");const service=new BackupService(db,{deviceId:()=>"existing-device"});
 const p=service.preview(fixture("backup-format1.json"));assert.equal(p.items.length,8);
 assert.deepEqual(service.apply(p.token,p.items.map(i=>i.key)),{imported:8,skipped:0});
 assert.equal(db.meta.get("deviceId"),"existing-device");
 const again=service.preview(fixture("backup-format1.json"));assert.ok(again.items.every(i=>i.status==="same"));
 } finally {db.close();}
});

test("backup rejects group identifiers the editor cannot address",()=>{
 const db=DesktopDatabase.open(":memory:");try {
 const service=new BackupService(db,{deviceId:()=>"local"}); const id="x".repeat(129);
 assert.throws(()=>service.preview(wrap([{kind:"group",id,body:{id,name:"Group",sites:["chatgpt"],updatedAt:1}}])),/backup_invalid/);
 } finally {db.close();}
});
