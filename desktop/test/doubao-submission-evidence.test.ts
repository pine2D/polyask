import test from 'node:test';
import assert from 'node:assert/strict';
import { DesktopDatabase } from '../src/main/database';
import { QuestionHistoryService } from '../src/main/question-history-service';
const { replayHtml } = require('../scripts/lib/dom-replay.js');
for (const failed of [false, true]) test(`optimistic Doubao bubble must not reverse submit_unconfirmed in main history (failure icon=${failed})`, async t => {
  const db = DesktopDatabase.open(':memory:');
  t.after(() => db.close());
  let mainNow = 1000;
  const history = new QuestionHistoryService(db.questions, {deviceId:()=> 'review',now:()=>++mainNow});
  const question = history.begin({runId:'run',sites:['doubao'],text:'Question',tier:null,images:[]})!;
  const token = history.token('doubao')!;
  let upgrades = 0;
  history.setSubmissionHandler(()=>{upgrades++;});
  const h = replayHtml('<main><section></section><textarea></textarea><button id="flow-end-msg-send">Send</button></main>', {host:'www.doubao.com',path:'/chat/12345678901234567'});
  t.after(h.close);
  h.window.HTMLElement.prototype.getBoundingClientRect=()=>({left:100,right:500,top:450,bottom:500,width:400,height:50});
  let now=1000,clicks=0;
  h.window.Date.now=()=>now;
  h.window.setTimeout=(fn:()=>void,ms:number)=>{if(ms>10000)return 1;now+=ms;queueMicrotask(fn);return 1;};
  h.window.clearTimeout=()=>{};
  // Generation monitoring is independent from submission/history ownership; avoid its long observer in this fake-clock fixture.
  h.S.armGeneration=()=>{};
  h.document.querySelector('button').onclick=()=>{
    clicks++;h.document.querySelector('textarea').value='';
    h.document.querySelector('section').innerHTML='<div data-testid="union_message" data-target-id="reused"><div data-message-role="user">'
      +(failed ? '<svg data-testid="message_box_failed_icon"></svg>' : '')+'<div data-testid="message_text_content">Question</div></div></div>';
  };
  const result=await h.send({source:'AMS',cmd:'submitPrompt',text:'Question',deadline:12000,historyToken:token});
  assert.equal(clicks,1);assert.equal(result.ok,false);assert.equal(result.code,'submit_unconfirmed');
  history.result('run',{site:'doubao',...result});
  assert.equal(db.questions.answers(question.id)[0].submission,'unconfirmed');
  const snapshot=h.S.history.snapshot(token);
  history.accept('doubao',snapshot,history.readMark());
  assert.equal(db.questions.answers(question.id)[0].submission,'unconfirmed','a failed/unkeyed optimistic bubble is not a server-accepted message');
  assert.equal(upgrades,0);
  if (!failed) {
    const role = h.document.querySelector('[data-message-role="user"]');
    role.setAttribute('data-message-id', 'accepted-message');
    history.accept('doubao', h.S.history.snapshot(token), history.readMark());
    assert.equal(db.questions.answers(question.id)[0].submission, 'submitted');
    assert.equal(upgrades, 1, 'an independently confirmed same turn may upgrade later');
  }
});
