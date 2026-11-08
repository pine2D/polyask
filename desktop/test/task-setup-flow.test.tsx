import test from 'node:test';
import assert from 'node:assert/strict';
import { act } from 'react';
import { SITES } from '../src/main/sites';
import type { WorkspaceState } from '../src/shared/workspace';
import type { SiteKey } from '../src/shared/contracts';
import type { SiteRunResult } from '../src/shared/protocol';
import { useWorkspaceFlow } from '../src/renderer/use-workspace-flow';
import { useSyncedSiteParticipation } from '../src/renderer/use-synced-site-participation';
import { ExclusiveActionLock } from '../src/renderer/broadcast-flow-state';
import { useTaskSetup } from '../src/renderer/use-task-setup';
import { setShellApi } from '../src/renderer/shell-api';
import { mountDom } from './ui/dom-harness';

function deferred<T>() { let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
async function fixture() {
  const opening = deferred<WorkspaceState>(), saving = deferred<WorkspaceState>();
  const tier = deferred<{workspace: WorkspaceState; results: readonly SiteRunResult[]}>();
  let flow!: ReturnType<typeof useWorkspaceFlow>, participation!: ReturnType<typeof useSyncedSiteParticipation>;
  let setup!: ReturnType<typeof useTaskSetup>, prompt = 'Original draft', intent = '1:original-image', busy = false;
  const lock = new ExclusiveActionLock(), calls: string[] = []; let notifications = 0;
  const template = {id:'current',name:'Current',text:'Task',updatedAt:1,deviceId:'d'};
  let templates = [template];
  const state: WorkspaceState = {selectedSites:['claude'], participatingSites:['claude'], groups:[], tier:null};
  setShellApi({setSelection: (keys: readonly SiteKey[]) => {calls.push(`open:${keys.join(',')}`); return opening.promise;},
    setParticipation: (keys: readonly SiteKey[]) => {calls.push(`save:${keys.join(',')}`); return saving.promise;},
    applyTier: () => {calls.push('tier'); return tier.promise;}, bootstrap: async () => ({workspace:state}),
    broadcast: () => {calls.push('SEND');}, newSession: () => {calls.push('NEW');}} as any);
  function Fixture() {
    flow = useWorkspaceFlow(SITES, 'failed', () => { notifications++; });
    participation = useSyncedSiteParticipation(flow, true, lock, () => {});
    setup = useTaskSetup({templates, groups:[], sites:SITES, prompt, imageCount:1,
      getIntent:()=>intent, busy:()=>busy, lock, participation, changeTier:flow.changeTier,
      onApply:value=>{prompt=value;}, onBlockingChange:()=>{}});
    return <span>{participation.participating.join(',')}</span>;
  }
  const h = await mountDom(<Fixture/>);
  await act(async()=>flow.accept(state));
  await act(async()=>setup.open());
  const plan = {text:'Prepared task', sites:['claude','kimi'] as const, tier:'think' as const};
  const openState = {...state,selectedSites:['claude','kimi'] as const};
  const accepted = {...state,selectedSites:['claude','kimi'] as const,participatingSites:['claude','kimi'] as const};
  return {...h, plan, accepted, openState, state, opening,saving,tier,lock,calls,template, participation:()=>participation, flow:()=>flow,
    expireSource:async()=>{templates=[];await h.render(<Fixture/>);}, setup:()=>setup, prompt:()=>prompt, notifications:()=>notifications,
    changeIntent:()=>{intent='2:new-image';}, setBusy:()=>{busy=true;},
    close:async()=>{await h.close();setShellApi(null);}};
}

test('real workspace and participation composition waits for open/save/tier ACK then replaces only text',async()=>{
  const h=await fixture();try {
    let applied!:Promise<boolean>;
    await act(async()=>{applied=h.setup().apply(h.plan);});
    assert.equal(h.prompt(),'Original draft'); assert.deepEqual(h.calls,['open:claude,kimi']);
    await act(async()=>h.opening.resolve(h.openState));
    assert.equal(h.prompt(),'Original draft');assert.deepEqual(h.calls,['open:claude,kimi','save:claude,kimi']);
    await act(async()=>h.saving.resolve(h.accepted));
    assert.equal(h.prompt(),'Original draft'); assert.equal(h.calls.at(-1),'tier');
    await act(async()=>{h.tier.resolve({workspace:h.accepted,results:[{site:'claude',ok:true},{site:'kimi',ok:true}]});assert.equal(await applied,true);});
    assert.equal(h.prompt(),'Prepared task');assert.equal(h.lock.busy,false);
    assert.equal(h.calls.some(value=>value==='SEND'||value==='NEW'),false);
  }finally{await h.close();}
});

for (const owner of ['current', 'cancelled', 'edited'] as const) test(`task tier failure only notifies the ${owner} owner when still current`, async () => {
  const h = await fixture(); try {
    let applied!: Promise<boolean>;
    await act(async () => { applied = h.setup().apply(h.plan); });
    await act(async () => h.opening.resolve(h.openState));
    await act(async () => h.saving.resolve(h.accepted));
    assert.equal(h.calls.at(-1), 'tier');
    if (owner === 'cancelled') await act(async () => h.setup().close());
    if (owner === 'edited') await act(async () => h.setup().edit());
    await act(async () => { h.tier.reject(Error('late tier IPC failure')); assert.equal(await applied, false); });
    assert.equal(h.notifications(), owner === 'current' ? 1 : 0);
    assert.equal(h.prompt(), 'Original draft');
    assert.equal(h.lock.busy, false);
  } finally { await h.close(); }
});

for(const reason of ['open-failure','save-failure','tier-failure','cancel','edit','new-image','busy','source-expired','scope-mismatch'] as const) {
  test(`task setup preserves draft and attachments after ${reason}`,async()=>{
    const h=await fixture();try {
      let applied!:Promise<boolean>;
      await act(async()=>{applied=h.setup().apply(reason==='source-expired'?{...h.plan,template:h.template}:h.plan);});
      if(reason==='cancel')await act(async()=>h.setup().close());
      if(reason==='edit')await act(async()=>h.setup().edit());
      if(reason==='new-image')h.changeIntent();
      if(reason==='busy')h.setBusy();
      if(reason==='source-expired')await h.expireSource();
      await act(async()=>reason==='open-failure'?h.opening.reject(Error('offline')):h.opening.resolve(h.openState));
      if(['cancel','edit','new-image','busy','source-expired'].includes(reason)) {
        assert.equal(h.calls.some(call=>call.startsWith('save:')),false,'an invalid task must not start save after the open ACK');
        assert.equal(h.participation().pending,false);assert.equal(h.lock.busy,false);
        assert.deepEqual(h.flow().currentSelection(),['claude','kimi'],'already accepted open pages are retained');
        assert.deepEqual(h.participation().currentSites(),['claude'],'accepted saved membership is retained without starting save');
      }
      await act(async()=>reason==='save-failure'?h.saving.reject(Error('offline')):h.saving.resolve(reason==='scope-mismatch'?h.state:h.accepted));
      await act(async()=>{h.tier.resolve({workspace:h.accepted,results:[{site:'claude',ok:reason!=='tier-failure'},{site:'kimi',ok:true}]});assert.equal(await applied,false);});
      assert.equal(h.prompt(),'Original draft');assert.equal(h.lock.busy,false);
      assert.equal(h.calls.some(value=>value==='SEND'||value==='NEW'),false);
      if(['cancel','edit','new-image','busy','source-expired','scope-mismatch'].includes(reason))assert.equal(h.calls.includes('tier'),false);
    }finally{await h.close();}
  });
}

test('task preparation refuses a busy broadcast or shared action lock before acquiring a cover',async()=>{
  const h=await fixture();try {
    await act(async()=>h.setup().close());
    h.setBusy();await act(async()=>h.setup().open());
    assert.equal(h.setup().session===null,true);assert.equal(h.calls.length,0);
  }finally{await h.close();}
  const other=await fixture();try {
    await act(async()=>other.setup().close());
    const release=deferred<void>(),operation=other.lock.run(()=>release.promise);
    await act(async()=>other.setup().open());assert.equal(other.setup().session===null,true);
    release.resolve();await operation;
  }finally{await other.close();}
});
test('an expired template selection is rejected before changing workspace or prompt',async()=>{
  const h=await fixture();try {
    await act(async()=>assert.equal(await h.setup().apply({...h.plan,
      template:{id:'deleted',name:'Deleted',text:'Old text',updatedAt:1,deviceId:'d'}}),false));
    assert.equal(h.setup().error,'stale');assert.equal(h.calls.length,0);assert.equal(h.prompt(),'Original draft');
  }finally{await h.close();}
});
