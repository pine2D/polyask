import { useLayoutEffect, useState } from 'react';
import type { DesktopCopy } from '../shared/copy';
import type { SiteDefinition } from '../shared/contracts';
import type { PromptTemplate } from '../shared/prompt-library';
import type { ActiveWorkspaceGroup } from '../shared/workspace';
import type { Tier } from '../shared/protocol';
import { promptVariables } from '../shared/prompt-variables';
import { taskSetupPrompt, type TaskPreset, type TaskSetupPlan } from '../shared/task-setup';
import { holdExternalNavigation } from './external-navigation-lock';
import { FolderModal } from './folder-modal';
import { ConfirmDialog } from './confirm-dialog';
import type { useTaskSetup } from './use-task-setup';
import './task-setup.css';

type Setup = ReturnType<typeof useTaskSetup>;
export function TaskSetup({setup,copy,sites,templates,groups}: {
  setup: Setup; copy: DesktopCopy; sites: readonly SiteDefinition[]; templates: readonly PromptTemplate[];
  groups: readonly ActiveWorkspaceGroup[];
}): React.JSX.Element {
  useLayoutEffect(holdExternalNavigation, []);
  const session = setup.session!;
  const [preset,setPreset] = useState<TaskPreset>('compare');
  const [text,setText] = useState(session.prompt || copy.taskSetupComparePrompt);
  const [dimensions,setDimensions] = useState(copy.taskSetupCompareDimensions);
  const [output,setOutput] = useState(copy.taskSetupCompareOutput);
  const [template,setTemplate] = useState<PromptTemplate | undefined>();
  const [group,setGroup] = useState<ActiveWorkspaceGroup | undefined>();
  const [tier,setTier] = useState<Tier>(null);
  const [variables,setVariables] = useState<Record<string,string>>({});
  const [confirmation,setConfirmation] = useState<TaskSetupPlan | null>(null);
  const base = template?.text ?? text;
  const preview = taskSetupPrompt(base,variables,dimensions,output,{dimensions:copy.taskSetupDimensions,output:copy.taskSetupOutput},!!template);
  const scope = group?.sites ?? session.sites;
  const apply = (plan: TaskSetupPlan) => setup.apply(plan);
  const choosePreset = (value: TaskPreset) => {
    setup.edit(); setPreset(value);
    const values = value === 'compare' ? [copy.taskSetupCompareDimensions,copy.taskSetupCompareOutput]
      : value === 'verify' ? [copy.taskSetupVerifyDimensions,copy.taskSetupVerifyOutput]
      : [copy.taskSetupReviseDimensions,copy.taskSetupReviseOutput];
    setDimensions(values[0]); setOutput(values[1]);
    if (!session.prompt && text === (preset === 'compare' ? copy.taskSetupComparePrompt : preset === 'verify' ? copy.taskSetupVerifyPrompt : copy.taskSetupRevisePrompt)) {
      setText(value === 'compare' ? copy.taskSetupComparePrompt : value === 'verify' ? copy.taskSetupVerifyPrompt : copy.taskSetupRevisePrompt);
    }
  };
  if (confirmation) return <ConfirmDialog copy={copy} title={copy.taskSetupApply} message={copy.taskSetupConfirm}
    confirmLabel={copy.taskSetupApply} cancelLabel={copy.draftKeepEditing}
    onCancel={()=>setConfirmation(null)} onConfirm={()=>{setConfirmation(null); void apply(confirmation);}}/>;
  return <FolderModal copy={copy} title={copy.taskSetup} busy={false} onCancel={setup.close} className="task-setup">
    <p>{copy.taskSetupHint}</p>
    <div className="task-setup-fields" aria-busy={setup.pending}>
      <label>{copy.taskSetupPreset}<select name="task-preset" value={preset} onChange={event=>choosePreset(event.target.value as TaskPreset)}>
        <option value="compare">{copy.taskSetupCompare}</option><option value="verify">{copy.taskSetupVerify}</option><option value="revise">{copy.taskSetupRevise}</option>
      </select></label>
      <label>{copy.taskSetupTemplate}<select name="task-template" value={template?.id ?? ''} onChange={event=>{
        setup.edit(); setTemplate(templates.find(item=>item.id===event.target.value)); setVariables({});
      }}><option value="">{copy.taskSetupNoTemplate}</option>{templates.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      {!template ? <label className="task-setup-wide">{copy.taskSetupText}<textarea name="task-text" rows={4} value={text} onChange={event=>{setup.edit();setText(event.target.value);}}/></label> : null}
      {(template ? promptVariables(base) : []).map((name,index)=><label className="task-setup-wide" key={name}>{name}<textarea rows={2} name={`task-variable-${index}`} value={variables[name] ?? ''}
        onChange={event=>{setup.edit();setVariables(previous=>({...previous,[name]:event.target.value}));}}/></label>)}
      <label>{copy.taskSetupGroup}<select name="task-group" value={group?.id ?? ''} onChange={event=>{setup.edit();setGroup(groups.find(item=>item.id===event.target.value));}}>
        <option value="">{copy.taskSetupCurrentGroup}</option>{groups.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}
      </select></label>
      <label>{copy.taskSetupTier}<select name="task-tier" value={tier ?? ''} onChange={event=>{setup.edit();setTier(event.target.value ? event.target.value as Tier : null);}}>
        <option value="">{copy.taskSetupKeepTier}</option><option value="think">{copy.think}</option><option value="fast">{copy.fast}</option>
      </select></label>
      <label>{copy.taskSetupDimensions}<textarea name="task-dimensions" rows={3} value={dimensions} onChange={event=>{setup.edit();setDimensions(event.target.value);}}/></label>
      <label>{copy.taskSetupOutput}<textarea name="task-output" rows={3} value={output} onChange={event=>{setup.edit();setOutput(event.target.value);}}/></label>
    </div>
    <section className="task-setup-preview" aria-label={copy.taskSetupPreview}>
      <h3>{copy.taskSetupScope}</h3><p data-task-scope>{scope.map(key=>sites.find(site=>site.key===key)?.label ?? key).join(' · ') || copy.newSessionNoSites}</p>
      <label>{copy.taskSetupPreview}<textarea name="task-preview" readOnly rows={7} value={preview ?? base}/></label>
      {preview === null ? <p role="status">{copy.templateInvalid}</p> : null}
    </section>
    {setup.error ? <p role="alert">{setup.error === 'stale' ? copy.taskSetupStale : copy.taskSetupFailed}</p> : null}
    <footer><button type="button" className="primary" data-task-apply disabled={setup.pending || preview === null || !scope.length} onClick={()=>{
      if (preview === null) return;
      const plan = {text:preview,sites:scope,tier,template,group};
      if (session.prompt.trim() || session.imageCount) setConfirmation(plan); else void apply(plan);
    }}>{setup.pending ? copy.taskSetupApplying : copy.taskSetupApply}</button></footer>
  </FolderModal>;
}
