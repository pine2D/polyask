import assert from "node:assert/strict";
import test from "node:test";
import { DataAdminService } from "../src/main/data-admin-service";
import { DesktopDatabase } from "../src/main/database";
import { createLocalDataServices } from "../src/main/local-data-services";

function fixture() {
  const db = DesktopDatabase.open(":memory:");
  const services = createLocalDataServices(db);
  const archive = services.archives.add({text:"Question",task:"Question",results:[{host:"claude.ai",label:"Claude",text:"Evidence"}]});
  const card = services.decisions.create({archiveId:archive.id,title:"Decision",conclusion:"",rationale:"",uncertainties:"",nextStep:"",status:"draft",evidence:[]});
  return {db,...services,archive,card,target:{kind:"archive" as const,id:archive.id}};
}

test("folders share originals and archive cards independently; deleting folders only removes organization", () => {
  const {db,folders,archives,decisions,archive,card,target}=fixture();
  try {
    assert.ok(folders, "folder service must be installed");
    const a=folders.create("A"),b=folders.create("B");
    folders.patchMemberships(target,[{folderId:a.id,present:true},{folderId:b.id,present:true}]);
    assert.deepEqual(new Set(folders.memberships(target)),new Set([a.id,b.id]));
    assert.deepEqual(folders.memberships({kind:"decision",id:card.id}),[]);
    assert.equal(folders.search({folderId:a.id}).length,1);
    folders.delete(a.id);
    assert.deepEqual(folders.memberships(target),[b.id]);
    assert.deepEqual(archives.get(archive.id),archive);
    assert.deepEqual(decisions.get(card.id),card);
    assert.ok(db.outbox.ready(0).some(x=>x.key===`folder:${a.id}`));
    folders.patchMemberships(target,[{folderId:b.id,present:false}]);
    assert.equal(folders.search({folderId:"__unfiled__"}).length,2);
    assert.ok(db.folders.listMemberships().every(x=>"deletedAt" in x));
  } finally {db.close();}
});

test("membership edits are delta based, atomic and reject invalid or deleted targets", () => {
  const {db,folders,archives,target}=fixture();
  try {
    assert.ok(folders, "folder service must be installed");
    const a=folders.create("A"),b=folders.create("B");
    folders.patchMemberships(target,[{folderId:a.id,present:true}]);
    folders.patchMemberships(target,[{folderId:b.id,present:true}]);
    folders.patchMemberships(target,[{folderId:a.id,present:false}]);
    assert.deepEqual(folders.memberships(target),[b.id]);
    assert.throws(()=>folders.patchMemberships(target,[{folderId:b.id,present:false},{folderId:"missing",present:true}]),/not_found/);
    assert.deepEqual(folders.memberships(target),[b.id]);
    assert.throws(()=>folders.patchMemberships({kind:"history",id:target.id} as never,[]),/invalid_request/);
    archives.delete(target.id);
    assert.equal(folders.search({folderId:b.id}).length,0);
    assert.throws(()=>folders.patchMemberships(target,[{folderId:a.id,present:true}]),/not_found/);
    assert.equal(folders.list().length,2);
  } finally {db.close();}
});

test("folder validation, mixed filters, monotonic rename and local reset", () => {
  const {db,folders,archives,archive,card,deviceId}=fixture();
  try {
    assert.ok(folders, "folder service must be installed");
    for (const name of ["", " ", "a\n", "a\u0085b", "x".repeat(81),[],null]) assert.throws(()=>folders.create(name as never),/invalid_request/);
    const folder=folders.create("  项目  ");
    assert.equal(folder.name,"项目");
    assert.ok(folders.rename(folder.id,"项目二").updatedAt>folder.updatedAt);
    assert.equal(folders.create("😀".repeat(80)).name.length,160);
    archives.update(archive.id,{tags:["tag"],favorite:true});
    assert.equal(folders.search({query:"Evidence"}).length,1);
    assert.equal(folders.search({tag:"absent"}).length,1); // Card is unaffected by archive-only filters.
    assert.equal(folders.search({kind:"decision",status:"draft"})[0].record.id,card.id);
    assert.equal(folders.search({status:"final"}).length,1); // Archive remains visible.
    const before=deviceId();
    db.resetLocalData();
    assert.deepEqual(folders.list(),[]);
    assert.deepEqual(db.folders.listMemberships(),[]);
    assert.equal(deviceId(),before);
  } finally {db.close();}
});

test("clearing folders tombstones relationships but preserves archives and decisions",()=>{
  const {db,folders,archives,decisions,target,card,deviceId}=fixture();
  try {
    const folder=folders.create("A");
    folders.patchMemberships(target,[{folderId:folder.id,present:true}]);
    const admin=new DataAdminService({database:db,deviceId,sync:{disconnect:async()=>{throw Error("unused");},status:()=>{throw Error("unused");}}});
    assert.equal(admin.clearFolders(),1);
    assert.equal(admin.clearFolders(),0);
    assert.ok("deletedAt" in db.folders.get(folder.id)!);
    assert.ok(db.folders.listMemberships().every(m=>"deletedAt" in m));
    assert.ok(archives.get(target.id));
    assert.ok(decisions.get(card.id));
    assert.deepEqual(folders.search({folderId:folder.id}),[]);
  } finally {db.close();}
});
