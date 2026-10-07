import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { DataAdminService } from '../src/main/data-admin-service';
import { DesktopDatabase } from '../src/main/database';
import { createLocalDataServices } from '../src/main/local-data-services';
import { questionAnswerId } from '../src/main/question-repository';
import { folderMembershipId } from '../src/shared/task-folder';
import type { SyncStatus } from '../src/shared/sync';
import { questionAnswerFixture, questionFixture } from './question-fixtures';

const status = (): SyncStatus => ({state:'idle',connected:false,pending:0,errorCount:0,readOnly:false,
  oauthConfigured:false,secureTokenStorage:true});
function seeded() {
  const db = DesktopDatabase.open(':memory:');
  const services = createLocalDataServices(db);
  const admin = new DataAdminService({database:db,deviceId:services.deviceId,now:()=>10000,
    sync:{disconnect:async()=>status(),status}});
  for (let i=0;i<130;i++) services.history.record(i===0 ? questionFixture().text : `Legacy ${i}`);
  db.questions.put(questionFixture()); db.questions.put(questionFixture('q-b'));
  db.questions.put(questionFixture('q-deleted')); db.questions.delete('q-deleted',100,'fixture');
  db.questions.putAnswer(questionAnswerFixture()); db.questions.putAnswer(questionAnswerFixture('q-a',2));
  db.questions.putAnswer(questionAnswerFixture('orphan'));
  // 模拟同步到达顺序遗留的活动子：分类清空只处理活动父；reset 包含全部子。
  const raw = (db as unknown as {database:DatabaseSync}).database;
  const late = questionAnswerFixture('q-deleted');
  const outOfScope = {...questionAnswerFixture(),site:'kimi',id:questionAnswerId('q-a','kimi',1)};
  for (const value of [late,outOfScope]) raw.prepare('INSERT INTO question_answers(id,question_id,site,attempt,body,deleted_at) VALUES(?,?,?,?,?,NULL)')
    .run(value.id,value.questionId,value.site,value.attempt,JSON.stringify(value));
  const archive=services.archives.add({task:'Question',text:'Question',results:[{host:'claude.ai',label:'Claude',text:'Saved'}]});
  const removed=services.archives.add({task:'Deleted',text:'Deleted',results:[{host:'claude.ai',label:'Claude',text:'Old'}]});
  services.archives.delete(removed.id);
  services.decisions.create({archiveId:archive.id,title:'Decision',conclusion:'',rationale:'',uncertainties:'',nextStep:'',status:'draft',evidence:[]});
  const folder=services.folders.create('Active'),deleted=services.folders.create('Deleted');services.folders.delete(deleted.id);
  const memberships=[{folderId:folder.id,targetId:archive.id},{folderId:folder.id,targetId:'missing-target'},
    {folderId:'orphan',targetId:archive.id},{folderId:deleted.id,targetId:archive.id}].map(value=>({...value,
      id:folderMembershipId({kind:'archive',id:value.targetId},value.folderId),targetKind:'archive' as const,
      schema:3 as const,createdAt:10,updatedAt:10,deviceId:'fixture'}));
  for (const value of memberships) db.folders.putMembership(value);
  db.folders.putMembership({...memberships[0],id:folderMembershipId({kind:'archive',id:'tombstone'},folder.id),
    targetId:'tombstone',deletedAt:20,updatedAt:20});
  for (const key of ['template:a','template:b','group:g','workspace','unregistered:value']) db.state.put(key,{id:key},10);
  for (const key of ['template:deleted','group:deleted']) db.state.put(key,{deletedAt:20},20);
  return {db,admin,memberships,activeAnswers:[questionAnswerFixture().id,questionAnswerFixture('q-a',2).id,outOfScope.id]};
}

test('statistics count every active category and distinguish orphan reset records without writes',()=>{
  const {db,admin}=seeded();
  try {
    const before={records:db.businessSnapshot(),outbox:db.outbox.ready(0),deviceId:db.meta.get('deviceId'),configuration:db.configuration()};
    assert.deepEqual(admin.stats(),{history:132,archives:1,decisions:1,folders:1,answers:3,memberships:2,
      reset:{answers:5,memberships:4,templates:2,groups:1,workspace:1}});
    assert.deepEqual({records:db.businessSnapshot(),outbox:db.outbox.ready(0),deviceId:db.meta.get('deviceId'),configuration:db.configuration()},before);
  } finally {db.close();}
});

test('category counts match actual clear results and its dependent tombstones, including missing targets',()=>{
  const {db,admin,memberships,activeAnswers}=seeded();
  try {
    const counts=admin.stats();
    assert.equal(admin.clearHistory(),counts.history); assert.equal(admin.clearFolders(),counts.folders);
    assert.equal(activeAnswers.filter(id=>'deletedAt' in db.questions.getAnswer(id)!).length,counts.answers);
    assert.equal(memberships.filter(value=>'deletedAt' in db.folders.getMembership(value.id)!).length,counts.memberships);
    assert.equal(admin.clearArchives(),counts.archives);assert.equal(admin.clearDecisions(),counts.decisions);
    assert.deepEqual(admin.stats(),{history:0,archives:0,decisions:0,folders:0,answers:0,memberships:0,
      reset:{answers:2,memberships:2,templates:2,groups:1,workspace:1}});
    assert.ok(db.outbox.count()>0);
  } finally {db.close();}
});

test('local reset removes counted records and preserves device identity',async()=>{
  const {db,admin}=seeded();
  try {
    const id=db.meta.get('deviceId');await admin.resetLocal();
    assert.deepEqual(admin.stats(),{history:0,archives:0,decisions:0,folders:0,answers:0,memberships:0,
      reset:{answers:0,memberships:0,templates:0,groups:0,workspace:0}});
    assert.equal(db.meta.get('deviceId'),id);assert.equal(db.outbox.count(),0);
  } finally {db.close();}
});
