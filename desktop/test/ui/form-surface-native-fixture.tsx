import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { CommandPalette, type CommandPaletteMode } from '../../src/renderer/command-palette';
import { WorkspaceDrawer } from '../../src/renderer/workspace-drawer';
import { SITES } from '../../src/main/sites';
import { getCopy } from '../../src/shared/copy';
import { COMMANDS } from '../../src/shared/commands';
import type { SiteKey } from '../../src/shared/contracts';
import type { ActiveWorkspaceGroup } from '../../src/shared/workspace';
import type { OpenWorkspacePanelState } from '../../src/renderer/workspace-panel-state';
import '../../src/renderer/styles.css';
import '../../src/renderer/settings.css';
import '../../src/renderer/accessibility.css';
import '../../src/renderer/feedback.css';

const query=new URLSearchParams(location.search),locale=query.get('locale')||'en',copy=getCopy(locale);
document.documentElement.lang=locale;
document.documentElement.dataset.density=query.get('density')||'compact';
if(query.has('expanded'))document.documentElement.style.setProperty('--composer-expanded-height','200px');
const noop=()=>{};
function Fixture(){
  const [mode,setMode]=useState<CommandPaletteMode>('library');
  const [panel,setPanel]=useState<OpenWorkspacePanelState|null>({tab:'sites',detail:null,sitesMode:'select',inputMethod:'keyboard'});
  const [sites,setSites]=useState<readonly SiteKey[]>(['claude','kimi']);
  const [groups,setGroups]=useState<ActiveWorkspaceGroup[]>([{id:'saved',name:'Saved review group',sites:['claude','chatgpt'],updatedAt:1,deviceId:'fixture'}]);
  const [applied,setApplied]=useState(''),[closed,setClosed]=useState(false);
  const templates=[{id:'variables',name:'Long task template · 需要完整保留的模板名称',text:'Review {{需要完整保留的比较条件需要完整保留的比较条件}}\nSource: {{source}}',updatedAt:1,deviceId:'fixture'}];
  (window as any).formNative={ready:true,snapshot:()=>({applied,closed,groups:groups.map(g=>g.name)})};
  if(closed)return <p data-fixture-closed>Closed</p>;
  if(query.get('surface')==='groups')return <main className={`app-shell${query.has('expanded')?' is-composer-expanded':''}`}>
    <WorkspaceDrawer copy={copy} sites={SITES} selected={new Set(SITES.map(s=>s.key))} participating={new Set(sites)} groups={groups}
      statuses={{}} health={{}} healthChecking={false} open={!!panel} state={panel??{tab:'sites',detail:null,inputMethod:'keyboard'}}
      onStateChange={setPanel} onSelectionChange={noop} onParticipationChange={setSites}
      onSaveGroup={async name=>{await new Promise(r=>setTimeout(r,80));setGroups(old=>[...old,{id:'new',name,sites,updatedAt:2,deviceId:'fixture'}]);return true;}}
      onDeleteGroup={id=>setGroups(old=>old.filter(g=>g.id!==id))} onCheckHealth={noop} onFocusSite={noop} onReloadSite={noop}
      onHardReloadSite={noop} onClearSiteData={noop} onCopyHealthReport={noop}/>
  </main>;
  return <CommandPalette copy={copy} commands={COMMANDS} menuShortcuts={[]} groups={groups} library={{templates,history:[]}}
    draft="Synthetic current draft" isMac={false} mode={mode} onModeChange={setMode} onExecute={noop} onApplyGroup={noop}
    onInsertPrompt={setApplied} onSaveTemplate={async()=>{await new Promise(r=>setTimeout(r,80));return false;}}
    onDeleteTemplate={noop} onClose={()=>setClosed(true)}/>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
