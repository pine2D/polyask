import assert from "node:assert/strict";
import test from "node:test";
import { DataAdminService } from "../src/main/data-admin-service";
import { DesktopDatabase } from "../src/main/database";
import { ArchiveService } from "../src/main/archive-service";
import { DecisionService } from "../src/main/decision-service";
import { isStoredDecision, type DecisionInput } from "../src/shared/decision";

function fixture() {
  const database=DesktopDatabase.open(":memory:");
  database.meta.put("deviceId","test-device");
  const archives=new ArchiveService(database.archives,{deviceId:()=>"test-device",now:()=>100,createId:()=>"a"});
  const archive=archives.add({text:"Original question",task:"Original question",results:[{host:"claude.ai",label:"Claude",text:"First evidence\nSecond paragraph"},{host:"chatgpt.com",label:"ChatGPT",text:"Other view"}]});
  let id=0;
  const service=new DecisionService(database.decisions,archives,{deviceId:()=>"test-device",now:()=>200,createId:()=>`d${++id}`});
  const input:DecisionInput={archiveId:archive.id,title:"Decision",conclusion:"Adopt A",rationale:"Because",uncertainties:"Check claim",nextStep:"Test",status:"verify",evidence:[{resultIndex:0,excerpt:"First evidence"}]};
  return {database,archives,service,input,archive};
}

test("decision cards are independent, copy validated evidence and search/filter without changing archives",()=>{
  const {database,service,input,archives,archive}=fixture();
  try{
    const a=service.create(input), b=service.create({...input,title:"Other",status:"draft",evidence:[]});
    assert.notEqual(a.id,b.id);
    assert.deepEqual(a.evidence,[{resultIndex:0,excerpt:"First evidence",host:"claude.ai",label:"Claude",capturedAt:100}]);
    assert.deepEqual(service.search({query:"because",status:"verify"}).map(x=>x.id),[a.id]);
    assert.equal(service.search({archiveId:archive.id}).length,2);
    assert.deepEqual(archives.get(archive.id),archive);
    assert.ok(database.outbox.ready(0).some(x=>x.key===`decision:${a.id}`));
    assert.ok(isStoredDecision(a));
    assert.equal(isStoredDecision({...a,schema:1}),false);
    assert.equal(isStoredDecision({...a,status:["final"],conclusion:""}),false);
    assert.equal(isStoredDecision({...a,evidence:[{...a.evidence[0],resultIndex:-1}]}),false);
  }finally{database.close();}
});
test("source deletion preserves evidence; updates can remove but cannot forge missing-source evidence",()=>{
  const {database,service,input,archives,archive}=fixture();
  try{
    const card=service.create(input);archives.delete(archive.id);
    assert.deepEqual(service.get(card.id),card);
    assert.ok(service.exportMarkdown(card.id,"en").includes("First evidence"));
    const updated=service.update(card.id,{...input,title:"Updated"});
    assert.ok(updated.updatedAt>card.updatedAt);
    assert.deepEqual(updated.evidence,card.evidence);
    assert.throws(()=>service.update(card.id,{...input,evidence:[{resultIndex:0,excerpt:"forged"}]}),/invalid_decision/);
    assert.equal(service.update(card.id,{...input,evidence:[]}).evidence.length,0);
    service.delete(card.id);
    assert.equal(service.get(card.id),null);
    const tombstone=database.decisions.get(card.id)!;
    assert.ok("deletedAt" in tombstone);
    assert.equal(isStoredDecision(tombstone),true);
    assert.equal(service.search({}).length,0);
  }finally{database.close();}
});
test("decision requests reject invalid fields, references, final-without-conclusion and archive changes",()=>{
  const {database,service,input}=fixture();
  try{
    const bad=[{title:" "},{title:"x".repeat(161)},{status:"unknown"},{status:["final"],conclusion:""},{status:"final",conclusion:" "},{conclusion:"x".repeat(4001)},{evidence:[{resultIndex:0,excerpt:"fake"}]},{evidence:[...input.evidence,...input.evidence]},{evidence:[{resultIndex:1.2,excerpt:"Other view"}]}];
    for(const patch of bad)assert.throws(()=>service.create({...input,...patch} as DecisionInput),/invalid_decision/);
    const card=service.create(input);
    assert.throws(()=>service.update(card.id,{...input,archiveId:"another"}),/invalid_decision/);
    assert.throws(()=>service.create({...input,archiveId:"another"}),/archive_not_found/);
    database.resetLocalData();
    assert.deepEqual(database.decisions.list(),[]);
    assert.equal(database.meta.get("deviceId"),"test-device");
  }finally{database.close();}
});


test("bulk archive deletion preserves decisions; clearing decisions tombstones only cards",()=>{
  const {database,archives,service,input}=fixture();
  try{
    const card=service.create(input);
    const admin=new DataAdminService({database,deviceId:()=>"test-device",now:()=>500,sync:{disconnect:async()=>{throw Error("not used");},status:()=>{throw Error("not used");}}});
    assert.equal(admin.clearArchives(),1);
    assert.equal(service.get(card.id)?.evidence[0].excerpt,"First evidence");
    assert.equal(admin.clearDecisions(),1);
    assert.equal(service.get(card.id),null);
    assert.ok("deletedAt" in database.decisions.get(card.id)!);
    assert.ok("deletedAt" in database.archives.get(input.archiveId)!);
    assert.equal(archives.get(input.archiveId),null);
  }finally{database.close();}
});
