// Synthetic host for production history, settings and backup components; no real IPC or network.
import React, { useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { QuestionHistory } from '../../src/renderer/question-history';
import { SettingsWorkspace } from '../../src/renderer/settings-workspace';
import { FeedbackProvider } from '../../src/renderer/feedback-provider';
import { setShellApi } from '../../src/renderer/shell-api';
import { getCopy } from '../../src/shared/copy';
import { SETTINGS_RECOVERY_COPY } from '../../src/shared/settings-recovery-copy';
import { proxyShellStubs } from './proxy-state-fixture';
import type { SyncStatus } from '../../src/shared/sync';
import type { DesktopImage } from '../../src/shared/images';
import '../../src/renderer/styles.css';
import '../../src/renderer/settings.css';
import '../../src/renderer/accessibility.css';
import '../../src/renderer/feedback.css';
const params = new URLSearchParams(location.search), locale = params.get('locale') || 'en';
document.documentElement.lang = locale;
const copy = { ...getCopy(locale), ...SETTINGS_RECOVERY_COPY[locale as 'en'] };
function original(name: string, width: number, height: number): DesktopImage {
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  const context = canvas.getContext('2d')!;
  context.fillStyle = '#f4f5f8'; context.fillRect(0, 0, width, height);
  context.fillStyle = '#20212b'; context.font = '20px sans-serif';
  for (let row = 0; row < height / 40; row++) context.fillText(`Synthetic image detail ${row + 1} · 原图文字`, 20, 36 + row * 40);
  context.fillStyle = '#4f46e5'; context.fillRect(width - 32, height - 32, 32, 32);
  const dataUrl = canvas.toDataURL('image/png');
  return { name, type: 'image/png', size: atob(dataUrl.split(',')[1]).length, dataUrl };
}
const images = [original('first.png', 1600, 900), original('second.png', 640, 960),
  original(params.has('long') ? 'original-synthetic-'.repeat(6) + '.png' : 'first.png', 1600, 900), original('last.png', 640, 960)];
const question = {schema:4 as const,id:'native-q',text:'Synthetic original-image question · 原图提问',sites:['claude'],requestedTier:null,inputImageCount:4,createdAt:10,updatedAt:10,deviceId:'fixture'};
const status: SyncStatus = {state:'idle' as const,connected:true,pending:0,errorCount:0,readOnly:false,oauthConfigured:true,secureTokenStorage:true,imageSyncEnabled:false};
let holdDownload = false, failDownload = false, finishDownload: (() => void) | null = null;
let delay = false, finish: (() => void) | null = null, finishSync: (() => void) | null = null;
const evidence = { sends:0, applied:0, syncPending:false, settings:[] as boolean[], backupModes:[] as string[], bytes:[] as number[], missing:false };
setShellApi({ ...proxyShellStubs(),
  setQuestionPanel:async()=>{},setSurface:async()=>{},onQuestionSaveFailed:()=>()=>{},
  onQuestionAttachmentSaveFailed:()=>()=>{}, listLegacyQuestions:async()=>({items:[],cursor:null}),
  listQuestions:async()=>({items:[{...question,savedSites:0,answers:[]}],cursor:null}),
  getQuestion:async()=>({question,answers:[]}),
  questionAttachments:async()=>evidence.missing ? null : ({schema:5,id:'a'.repeat(64),questionId:question.id,createdAt:10,updatedAt:10,deviceId:'fixture',images:images.map(({name,type,size})=>({name,type,size,sha256:'b'.repeat(64)}))}),
  questionAttachment:async({index}:{index:number})=>{evidence.bytes.push(index);return images[index];},
  questionFetchAttachments:async()=>{evidence.missing=false;return true;},
  questionReask:async()=>{if(delay)await new Promise<void>(resolve=>{finish=resolve;});return {questionId:question.id,text:question.text,images};},
  broadcast:async()=>{evidence.sends++;},
  syncNow:async()=>{evidence.syncPending=true;await new Promise<void>(resolve=>{finishSync=resolve;});evidence.syncPending=false;return status;},
  setImageSyncEnabled:async(enabled:boolean,confirmed:boolean)=>{if(enabled&&!confirmed)throw new Error('confirmation missing');evidence.settings.push(enabled);return {...status,imageSyncEnabled:enabled};},
  exportBackup:async(mode:string)=>{evidence.backupModes.push(mode);if(mode==='download'&&holdDownload){await new Promise<void>(resolve=>{finishDownload=resolve;});if(failDownload)throw new Error('backup_failed');}return mode==='text-only'?'text-only':{missing:Array.from({length:8},(_,index)=>({questionId:`missing-${index}`,title:`${question.text} ${index+1}`,count:4,images:images.map(({name,type,size})=>({name,type,size,sha256:'b'.repeat(64)}))}))};},
  cancelBackup:async()=>{},getLocalDataStats:async()=>({history:0,archives:0,decisions:0,folders:0,answers:0,memberships:0,drafts:0,reset:{}})
} as any);
const noop=()=>{};
function App(){
  const [open,setOpen]=useState(true),[draft,setDraft]=useState('Unsent draft · 未发送草稿');
  const [draftImages,setDraftImages]=useState<readonly DesktopImage[]>([images[1]]);
  const [screen,setScreen]=useState(params.get('screen')||'history');
  const [sync,setSync]=useState(status);
  const revision=useRef(0);
  const edit=(text:string)=>{revision.current++;setDraft(text);};
  (window as any).nativeImages={copy,evidence,images,question,
    state:()=>({draft,names:draftImages.map(i=>i.name),...evidence}),
    delay:(value:boolean)=>{delay=value;}, release:()=>{delay=false;finish?.();finish=null;},
    edit, reset:()=>{revision.current++;setDraft('');setDraftImages([]);setOpen(false);},
    open:()=>setOpen(true), screen:setScreen, sync:setSync,
    holdDownload:()=>{holdDownload=true;}, releaseDownload:(failed:boolean)=>{failDownload=failed;holdDownload=false;finishDownload?.();finishDownload=null;}, finishSync:()=>finishSync?.(),
    missing:()=>{evidence.missing=true;}, ready:true};
  return <FeedbackProvider copy={copy}><main>
    <textarea aria-label="Synthetic draft" value={draft} onChange={event=>edit(event.target.value)} />
    {screen==='history'&&<QuestionHistory open={open} copy={copy} sites={[]} draft={draft} draftImageCount={draftImages.length}
      draftIntent={()=>String(revision.current)} imageSyncEnabled={true} busy={false} locale={locale}
      onBlockingChange={noop} onOpen={()=>setOpen(true)} onClose={()=>setOpen(false)}
      onDraft={(text,next)=>{evidence.applied++;revision.current++;setDraft(text);setDraftImages(next);}} />}
    {(screen==='settings'||screen==='backup')&&<SettingsWorkspace copy={copy} locale={locale} runtime={{version:'1.23.1',distribution:'installed'}} status={sync}
      onStatus={setSync} onAnnounce={noop} onClose={noop}/>}
  </main></FeedbackProvider>;
}
createRoot(document.getElementById('root')!).render(<App/>);
