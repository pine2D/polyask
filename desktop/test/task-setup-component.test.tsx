import test from 'node:test';
import assert from 'node:assert/strict';
import { act, useRef, useState } from 'react';
import { getCopy } from '../src/shared/copy';
import type { DesktopSurface } from '../src/shared/protocol';
import { SITES } from '../src/main/sites';
import { useTaskSetup } from '../src/renderer/use-task-setup';
import { useDraftConfirmation } from '../src/renderer/use-draft-confirmation';
import { requestSurfaceChange } from '../src/renderer/surface-transition';
import { useImageSelection } from '../src/renderer/use-image-selection';
import { DraftRevision } from '../src/renderer/prompt-draft';
import { ExclusiveActionLock } from '../src/renderer/broadcast-flow-state';
import { mountDom } from './ui/dom-harness';

const copy=getCopy('en');
const template={id:'t',name:'Argument template',text:'Review {{topic}}',updatedAt:1,deviceId:'fixture'};
const group={id:'g',name:'Pair',sites:['claude','kimi'] as const,updatedAt:1,deviceId:'fixture'};

test('real native-cover transition snapshots image intent after acquisition and explicitly applies a filled preview',async()=>{
  const oldCss=require.extensions['.css']; require.extensions['.css']=()=>{};
  const {TaskSetup}=require('../src/renderer/task-setup');
  let setup!:ReturnType<typeof useTaskSetup>, images!:ReturnType<typeof useImageSelection>;
  let prompt='Original draft', surface:DesktopSurface='sites', accepted:readonly any[]=['claude'];
  const selections:string[]=[], tiers:string[]=[], revision=new DraftRevision();
  const lock=new ExclusiveActionLock();
  function Fixture(){
    const [,render]=useState(0), commands=useRef({}), confirmation=useDraftConfirmation(commands);
    images=useImageSelection(copy,true,()=>{});
    const change=(next:DesktopSurface)=>requestSurfaceChange(surface,next,{surfaceChanged:confirmation.surfaceChanged,
      closeImages:images.invalidateAndClose,closeHistory:()=>{},resetComposer:()=>{},closeDrawer:()=>{},commit:value=>{surface=value;render(n=>n+1);}});
    setup=useTaskSetup({templates:[template],groups:[group],sites:SITES,prompt,imageCount:images.images.length,
      getIntent:()=>`${revision.current}:${images.intent()}`,busy:()=>false,lock,
      participation:{pending:false,currentSites:()=>accepted,change:async(value:readonly any[])=>{selections.push(value.join(','));accepted=value;return true;}} as any,
      changeTier:async()=>{tiers.push('think');return accepted.map(site=>({site,ok:true}));},
      onApply:value=>{prompt=value;revision.edit();},onBlockingChange:(value,owner)=>confirmation.change(value,owner,change)});
    return <><button id="opener" onClick={setup.open}>Prepare</button>{setup.session?<TaskSetup setup={setup} copy={copy} sites={SITES} templates={[template]} groups={[group]}/>:null}</>;
  }
  const h=await mountDom(<Fixture/>);
  const select=async(name:string,value:string)=>act(async()=>{const n=h.document.querySelector<HTMLSelectElement>(`[name=${name}]`)!;n.value=value;n.dispatchEvent(new h.window.Event('change',{bubbles:true}));});
  try {
    await act(async()=>images.replace([{name:'fixture.png',mimeType:'image/png',dataUrl:'data:image/png;base64,AA=='} as any]));
    const intent=images.intent();
    await h.click(h.document.querySelector('#opener')!);
    assert.equal(surface,'confirmation');assert.equal(images.intent()>intent,true);
    await select('task-template','t');
    assert.equal(h.document.querySelector<HTMLButtonElement>('[data-task-apply]')!.disabled,true);
    await h.input(h.document.querySelector('[name=task-variable-0]')!,'{{literal}} $1');
    await select('task-group','g');await select('task-tier','think');
    await h.input(h.document.querySelector('[name=task-dimensions]')!,'My custom dimensions');
    await h.input(h.document.querySelector('[name=task-output]')!,'My custom output');
    const preview=h.document.querySelector<HTMLTextAreaElement>('[name=task-preview]')!.value;
    assert.equal(preview,'Review {{literal}} $1\n\nComparison dimensions\nMy custom dimensions\n\nExpected output\nMy custom output');
    assert.equal(h.document.querySelector('[data-task-scope]')!.textContent,'Claude · Kimi');
    await h.click(h.document.querySelector('[data-task-apply]')!);
    assert.equal(prompt,'Original draft');assert.equal(selections.length,0);
    await h.click(h.document.querySelector('.confirm-actions button:not(.primary)')!);
    assert.equal(h.document.querySelector<HTMLTextAreaElement>('[name=task-output]')!.value,'My custom output');
    await h.click(h.document.querySelector('[data-task-apply]')!);
    await h.click(h.document.querySelector('.confirm-actions .primary')!);
    assert.equal(prompt,preview);assert.deepEqual(selections,['claude,kimi']);assert.deepEqual(tiers,['think']);
    assert.equal(images.images.length,1);assert.equal(images.images[0].name,'fixture.png');assert.equal(surface,'sites');
  }finally{await h.close();require.extensions['.css']=oldCss;}
});
