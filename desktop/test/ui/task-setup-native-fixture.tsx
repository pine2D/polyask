import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { getCopy } from '../../src/shared/copy';
import type { DesktopSurface, SiteRunResult, Tier } from '../../src/shared/protocol';
import type { WorkspaceState } from '../../src/shared/workspace';
import { SITES } from '../../src/main/sites';
import { useWorkspaceFlow } from '../../src/renderer/use-workspace-flow';
import { useSyncedSiteParticipation } from '../../src/renderer/use-synced-site-participation';
import { useTaskSetup } from '../../src/renderer/use-task-setup';
import { useImageSelection } from '../../src/renderer/use-image-selection';
import { useDraftConfirmation } from '../../src/renderer/use-draft-confirmation';
import { requestSurfaceChange } from '../../src/renderer/surface-transition';
import { DraftRevision } from '../../src/renderer/prompt-draft';
import { ExclusiveActionLock } from '../../src/renderer/broadcast-flow-state';
import { focusPromptForEditing } from '../../src/renderer/composer-activation';
import { TaskSetup } from '../../src/renderer/task-setup';
import { setShellApi } from '../../src/renderer/shell-api';
import { executeCommand } from '../../src/renderer/command-dispatcher';
import '../../src/renderer/styles.css';
import '../../src/renderer/settings.css';
import '../../src/renderer/accessibility.css';
import '../../src/renderer/feedback.css';
const locale=new URLSearchParams(location.search).get('locale') || 'en',copy=getCopy(locale);
document.documentElement.lang=locale;
const templates=[{id:'template',name:copy.taskSetupVerify,text:'Check {{topic}}',updatedAt:1,deviceId:'native'}];
const groups=[{id:'pair',name:'Claude + Kimi',sites:['claude','kimi'] as const,updatedAt:1,deviceId:'native'}];
let state:WorkspaceState={selectedSites:['claude'],participatingSites:['claude'],tier:null,groups};
let failure='', delay=0, broadcasts=0, sessions=0, notifications=0, tierCalls=0;
const pause=()=>new Promise(resolve=>setTimeout(resolve,delay));
setShellApi({setSelection:async (value:WorkspaceState['selectedSites'])=>{await pause();if(failure==='open')throw Error('fixture open failure');state={...state,selectedSites:value};return state;},
  setParticipation:async (value:WorkspaceState['selectedSites'])=>{await pause();if(failure==='save')throw Error('fixture save failure');state={...state,participatingSites:value};return state;},
  applyTier:async (tier:Tier)=>{tierCalls++;await pause();if(failure==='tier-reject')throw Error('fixture tier failure');state={...state,tier};return {workspace:state,results:state.participatingSites!.map(site=>({site,ok:failure!=='tier'})) as SiteRunResult[]};},
  bootstrap:async()=>({workspace:state}),broadcast:async()=>{broadcasts++;throw Error('must not send');},newSession:async()=>{sessions++;throw Error('must not navigate');}} as any);
export function TaskSetupNativeFixture({ onPrepared }: { onPrepared?: (prompt: string) => void } = {}){
  const prepared = useRef('');
  const lock=useRef(new ExclusiveActionLock()).current, revision=useRef(new DraftRevision()).current;
  const [prompt,setPrompt]=useState('Synthetic current draft'),[surface,setSurface]=useState<DesktopSurface>('sites');
  const commands=useRef({}),confirmation=useDraftConfirmation(commands);
  const flow=useWorkspaceFlow(SITES,'workspace failed',()=>{notifications++;});
  const participation=useSyncedSiteParticipation(flow,true,lock,()=>{notifications++;});
  const images=useImageSelection(copy,true,()=>{});
  const change=(next:DesktopSurface)=>requestSurfaceChange(surface,next,{surfaceChanged:confirmation.surfaceChanged,
    closeImages:images.invalidateAndClose,closeHistory:()=>{},resetComposer:()=>{},closeDrawer:()=>{},commit:setSurface});
  const setup=useTaskSetup({templates,groups,sites:SITES,prompt,imageCount:images.images.length,lock,participation,changeTier:flow.changeTier,
    getIntent:()=>`${revision.current}:${images.intent()}`,busy:()=>false,onApply:value=>{revision.edit();setPrompt(value);prepared.current=value;},
    onApplied:()=>{focusPromptForEditing({current:document.querySelector<HTMLTextAreaElement>('[name=fixture-draft]')},()=>{});onPrepared?.(prepared.current);},
    onBlockingChange:(value,owner)=>confirmation.change(value,owner,change)});
  useEffect(()=>{flow.accept(state);images.replace([{name:'synthetic.png',mime:'image/png',bytes:1,dataUrl:'data:image/png;base64,AA=='} as any]);},[]);
  (window as any).taskNative={copy,configure:(kind:string,wait=0)=>{failure=kind;delay=wait;},
    snapshot:()=>({prompt,images:images.images.length,imageName:images.images[0]?.name,scope:participation.currentSites(),
      pending:setup.pending,error:setup.error,surface,lock:lock.busy,broadcasts,sessions,notifications,tierCalls,open:!!setup.session})};
  return <main style={{padding:20}}><button id="task-opener" onClick={()=>executeCommand('open-task-setup',{'open-task-setup':setup.open})}>{copy.taskSetup}</button>
    <textarea name="fixture-draft" value={prompt} readOnly/>
    {setup.session?<TaskSetup setup={setup} copy={copy} sites={SITES} templates={templates} groups={groups}/>:null}
  </main>;
}
if (!new URLSearchParams(location.search).has('combined')) createRoot(document.getElementById('root')!).render(<TaskSetupNativeFixture/>);
