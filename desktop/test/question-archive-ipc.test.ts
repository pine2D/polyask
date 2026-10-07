import assert from 'node:assert/strict';
import test from 'node:test';
import {runInNewContext} from 'node:vm';
import {transformSync} from 'esbuild';
import {readSource} from './fixtures';
import {DesktopDatabase} from '../src/main/database';
import {createLocalDataServices} from '../src/main/local-data-services';
import * as historyTypes from '../src/shared/question-history';
import {QuestionArchiveService} from '../src/main/question-archive-service';
import {SITES} from '../src/main/sites';
import {questionAnswerFixture,questionFixture} from './question-fixtures';

test('history archive IPC rejects foreign senders and validates the full request before a single archive write',()=>{
  const handlers=new Map<string,(event:unknown,value?:unknown)=>unknown>();
  const exported={exports:{} as {registerQuestionHistoryIpc:(options:unknown)=>()=>void}};
  class Restore {cancel(){} }
  runInNewContext(transformSync(readSource('src/main/question-history-ipc.ts'),{loader:'ts',format:'cjs'}).code,{
    module:exported,exports:exported.exports,require:(name:string)=>{
      if(name==='../shared/question-history')return historyTypes;
      if(name==='./question-restore-service')return {QuestionRestoreService:Restore};
      if(name==='./question-archive-service')return {QuestionArchiveService};
      if(name==='./sites')return {SITES};
      assert.equal(name,'electron');return {ipcMain:{handle:(key:string,fn:any)=>handlers.set(key,fn),removeHandler:(key:string)=>handlers.delete(key)}};
    }});
  const db=DesktopDatabase.open(':memory:'),services=createLocalDataServices(db);
  let views=0;const manager=new Proxy({},{get:()=>()=>{views++;throw new Error('live site action is not allowed');}});
  const dispose=exported.exports.registerQuestionHistoryIpc({...services,manager,workspace:{},gate:{},
    window:{isDestroyed:()=>false},trusted:(value:unknown)=>value===true,publishWorkspace:()=>{views++;},flush:()=>{views++;}});
  try {
    db.questions.put(questionFixture());db.questions.putAnswer(questionAnswerFixture());
    const handler=handlers.get('polyask:question-archive');
    assert.ok(handler,'trusted history archive handler must be registered');
    const request={questionId:'q-a',answers:[{answerId:questionAnswerFixture().id,updatedAt:10}],locale:'en'};
    const before=db.outbox.count();
    assert.throws(()=>handler(false,request),/untrusted_sender/);
    for(const value of [null,{}, {...request,locale:'unknown'}, {...request,answers:[{...request.answers[0],updatedAt:11}]}])
      assert.throws(()=>handler(true,value));
    assert.equal(db.archives.list().length,0);assert.equal(db.outbox.count(),before);
    const record=handler(true,request) as {text:string;results:{text:string}[];source:unknown};
    assert.equal(record.text,questionFixture().text);assert.equal(record.results[0].text,questionAnswerFixture().answerMarkdown);
    assert.equal(record.source,null);assert.equal(db.archives.list().length,1);assert.equal(views,0);
    dispose();assert.equal(handlers.size,0);
  } finally {db.close();}
});
