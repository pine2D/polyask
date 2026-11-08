import assert from 'node:assert/strict';
import test from 'node:test';
import { DesktopDatabase } from '../src/main/database';
import { ArchiveService } from '../src/main/archive-service';
import { DecisionService } from '../src/main/decision-service';
import { DraftRepository } from '../src/main/draft-repository';
import { SyncRepository } from '../src/main/sync-repository';
import { projectBody } from '../src/main/backup-validation';
import { parseDecisionContent } from '../src/renderer/editor-draft-content';
import { isStoredDecision } from '../src/shared/decision';
import { mergeStateFragments } from '../src/shared/sync';
function setup() {
  const db = DesktopDatabase.open(':memory:'); db.meta.put('deviceId', 'local');
  const archives = new ArchiveService(db.archives, { deviceId: () => 'local', now: () => 100, createId: () => 'source' });
  const source = archives.add({ text: 'Question', task: 'Question', results: [{host:'claude.ai',label:'Claude',text:'First excerpt. Second excerpt.'}] });
  const service = new DecisionService(db.decisions, archives, {deviceId: () => 'local',now:()=>200,createId:()=> 'card'});
  const input = { archiveId: source.id, sourceUpdatedAt: source.updatedAt, title:'Card', conclusion:'', rationale:'', uncertainties:'', nextStep:'', status:'draft' as const,
    evidence:[{id:'quote-a',topic:'Cost',resultIndex:0,excerpt:'First excerpt.'},{id:'quote-b',topic:'Cost',resultIndex:0,excerpt:'Second excerpt.'}] };
  return {db,archives,source,service,input};
}
test('multiple excerpts retain identities and topics across save, remove and orphan editing', () => {
  const {db,archives,service,input} = setup();
  try {
    const saved = service.create(input); assert.equal(saved.schema,6); assert.equal(saved.evidence.length,2);
    assert.equal(isStoredDecision(saved),true); assert.equal((saved.evidence[1] as any).id,'quote-b');
    assert.deepEqual(projectBody('decision',saved).evidence,saved.evidence);
    assert.deepEqual(parseDecisionContent(input,input.archiveId),input);
    assert.equal(service.exportMarkdown(saved.id,'en').includes('Cost'),true);
    archives.delete(input.archiveId);
    const changed = service.update(saved.id,{...input,title:'Changed',evidence:[input.evidence[1]]});
    assert.equal((changed.evidence[0] as any).id,'quote-b');
    assert.throws(()=>service.update(saved.id,{...input,evidence:[{...input.evidence[1],id:'forged'}]}),/invalid_decision/);
    assert.throws(()=>service.update(saved.id,{...input,evidence:[{...input.evidence[1],topic:'Changed'}]}),/invalid_decision/);
  } finally {db.close();}
});
test('duplicate tuple and stale source version reject while distinct topics remain distinct',()=>{
  const {db,service,input} = setup();
  try {
    assert.throws(()=>service.create({...input,sourceUpdatedAt:99}),/invalid_decision/);
    assert.throws(()=>service.create({...input,evidence:[input.evidence[0],{...input.evidence[0],id:'another'}]}),/invalid_decision/);
    assert.equal(service.create({...input,evidence:[input.evidence[0],{...input.evidence[0],id:'another',topic:'Speed'}]}).evidence.length,2);
  } finally {db.close();}
});
test('standalone multi-evidence drafts use protected format and state envelope without upgrading ordinary state',()=>{
  const {db,input} = setup();
  try {
    const repo=new SyncRepository(db); assert.equal(repo.localStateFragment().schema,1);
    const drafts = new DraftRepository(db.state,db.meta); drafts.setSyncEnabled(true);
    const draft=drafts.save({kind:'decision',context:input.archiveId,title:'Draft',content:input});
    assert.equal(draft.format,2);
    const state=repo.localStateFragment(); assert.equal(state.schema,6);
    assert.equal(mergeStateFragments([state]).readOnly,false);
    assert.deepEqual(projectBody('draft',draft).content,input);
    drafts.remove(draft.id); assert.equal(drafts.get(draft.id)?.format,2);
    assert.equal(repo.localStateFragment().schema,6);
  } finally {db.close();}
});

test('extended evidence requires a version and honors 36 items, 120 codepoints and aggregate UTF8 caps',()=>{
  const {db,service,input} = setup();
  try {
    assert.throws(()=>service.create({...input,sourceUpdatedAt:undefined}),/invalid_decision/);
    assert.throws(()=>service.create({...input,evidence:[{...input.evidence[0],topic:'😀'.repeat(121)}]}),/invalid_decision/);
    const evidence=Array.from({length:36},(_,i)=>({...input.evidence[0],id:`item-${i}`,topic:`Topic ${i}`}));
    assert.equal(service.create({...input,evidence}).evidence.length,36);
    assert.throws(()=>service.create({...input,evidence:[...evidence,{...evidence[0],id:'last',topic:'Last'}]}),/invalid_decision/);
    const drafts=new DraftRepository(db.state,db.meta);
    const huge={...input,evidence:evidence.map(e=>({...e,excerpt:'😀'.repeat(4000)}))};
    assert.throws(()=>drafts.save({kind:'decision',context:input.archiveId,title:'Huge',content:huge}),/invalid_draft/);
    assert.equal(huge.evidence[35].excerpt.length,8000);
    assert.equal(drafts.list().length,0);
  } finally {db.close();}
});

test('decision and unsaved evidence drafts roundtrip through production sync and backup restore', async()=>{
  const {db,service,input}=setup();
  const other=DesktopDatabase.open(':memory:'); other.meta.put('deviceId','other');
  const {BackupService}=await import('../src/main/backup-service');
  const {SyncEngine}=await import('../src/main/sync-engine');
  const backup=new BackupService(db,{deviceId:()=> 'local'}), restore=new BackupService(other,{deviceId:()=> 'other'});
  const files=new Map<string,any>();
  const drive={getStartToken:async()=> 'start',listFiles:async()=>[...files.values()].map(e=>e.file),
    listChanges:async()=>({changes:[...files.values()].map(e=>({fileId:e.file.id,file:e.file})),newStartPageToken:'next'}),
    download:async(id:string)=>files.get(id)?.body,upsert:async(id:string|null,name:string,appProperties:any,body:any)=>{
      const file={id:id??name,name,appProperties};files.set(file.id,{file,body:structuredClone(body)});return file;},clearAll:async()=>{}};
  const engine=(database:DesktopDatabase)=>{const repository=new SyncRepository(database);repository.saveConfig({connected:true});
    return new SyncEngine({repository,drive,auth:{configured:()=>true,securePersistence:()=>true,connect:async()=>{},disconnect:async()=>{}}});};
  try {
    const saved=service.create(input), drafts=new DraftRepository(db.state,db.meta);drafts.setSyncEnabled(true);
    const draft=drafts.save({kind:'decision',context:'unsaved',title:'Unfinished',content:input});
    const incoming=new DraftRepository(other.state,other.meta);incoming.setSyncEnabled(true);
    assert.equal((await engine(db).syncNow()).state,'idle');
    assert.equal((await engine(other).syncNow()).state,'idle');
    assert.deepEqual(other.decisions.get(saved.id),saved); assert.deepEqual(incoming.get(draft.id)?.content,input);
    const doc=backup.export();assert.equal(doc.version,5);
    const preview=restore.preview(doc);restore.apply(preview.token,preview.items.map(i=>i.key));
    assert.equal(other.decisions.list()[0].evidence.length,2);
    assert.equal(incoming.list().some(d=>d.format===2&&JSON.stringify(d.content)===JSON.stringify(input)),true);
  } finally {backup.dispose();restore.dispose();db.close();other.close();}
});

test('topic search and both export projections retain every passage and judgment topic',async()=>{
  const {db,service,input,archives}=setup();
  const {createLocalDataServices}=await import('../src/main/local-data-services');
  const {renderReportHtml}=await import('../src/main/report-template');
  const {MarkdownSources}=await import('../src/main/markdown-export-source');
  const {getCopy}=await import('../src/shared/copy');
  try {
    const saved=service.create(input);
    assert.equal(createLocalDataServices(db).folders.query({query:'Cost'}).total,1);
    const html=renderReportHtml({kind:'decision',decision:saved,archive:archives.get(input.archiveId)});
    assert.equal(html.includes('Cost'),true);
    for(const e of input.evidence)assert.equal(html.includes(e.excerpt),true);
    const sources=new MarkdownSources({questions:db.questions,archives,decisions:service}),target={kind:'decision' as const,id:saved.id};
    const preview=sources.preview(target,getCopy('en'));
    const {markdown}=sources.read({target,revision:preview.revision,entryIds:['decision']},getCopy('en'));
    assert.equal(markdown.includes('Cost'),true);
    const rendered=new (require("markdown-it"))().render(markdown);
    for(const e of input.evidence)assert.equal(rendered.includes(e.excerpt),true);
  } finally {db.close();}
});

test('a legacy empty decision can adopt an explicit source version without inventing evidence',()=>{
  const {db,service,input}=setup();
  try {
    const saved=service.create({...input,sourceUpdatedAt:undefined,evidence:[]});
    assert.equal(saved.schema,2);
    const next=service.update(saved.id,{...input,evidence:[]});
    assert.equal(next.schema,6); assert.equal(next.sourceUpdatedAt,input.sourceUpdatedAt);
  } finally {db.close();}
});
