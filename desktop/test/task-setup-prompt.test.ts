import test from 'node:test';
import assert from 'node:assert/strict';
import { taskSetupPrompt, taskSetupSourcesCurrent } from '../src/shared/task-setup';

test('task preview fills template variables exactly once and retains editable dimensions and output',()=>{
  assert.equal(taskSetupPrompt('Review {{topic}}',{topic:'{{literal}} $1'},'Costs\n风险','My own result',{dimensions:'Dimensions',output:'Output'}),
    'Review {{literal}} $1\n\nDimensions\nCosts\n风险\n\nOutput\nMy own result');
  assert.equal(taskSetupPrompt('Review {{topic}}',{},'','',{dimensions:'D',output:'O'}),null);
  assert.equal(taskSetupPrompt('x'.repeat(100_000),{},'extra','',{dimensions:'D',output:'O'}),null);
});
test('removed or updated template/group invalidates a prepared plan without substituting its preview',()=>{
  const template={id:'t',name:'T',text:'Original {{topic}}',updatedAt:1,deviceId:'d'};
  const group={id:'g',name:'G',sites:['claude'] as const,updatedAt:1,deviceId:'d'};
  const plan={text:'Ready',sites:group.sites,tier:null,template,group};
  assert.equal(taskSetupSourcesCurrent(plan,[template],[group]),true);
  assert.equal(taskSetupSourcesCurrent(plan,[],[group]),false);
  assert.equal(taskSetupSourcesCurrent(plan,[{...template,text:'New'}],[group]),false);
  assert.equal(taskSetupSourcesCurrent(plan,[template],[{...group,sites:['kimi']}]),false);
});

test('ordinary task text preserves literal braces when reopening an already filled draft',()=>{
  assert.equal(taskSetupPrompt('Review {{literal}} $1',{},'','',{dimensions:'D',output:'O'},false),'Review {{literal}} $1');
});
