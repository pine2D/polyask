import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ManualComparison, useComparisonWorksheet } from '../../src/renderer/manual-comparison';
import { DecisionWorkspace } from '../../src/renderer/decision-workspace';
import { excerptSource } from '../../src/renderer/answer-excerpt';
import { setShellApi } from '../../src/renderer/shell-api';
import { getCopy } from '../../src/shared/copy';
import type { ArchiveRecord } from '../../src/shared/archive';
import type { DecisionInput } from '../../src/shared/decision';
import '../../src/renderer/styles.css';
import '../../src/renderer/settings.css';
import '../../src/renderer/accessibility.css';
import '../../src/renderer/feedback.css';
const bridge=(window as any).evidenceNative;
setShellApi(new Proxy({} as any,{get:(_,key)=>key==='onDraftsChanged'?()=>()=>{}:(...args:any[])=>bridge.call(String(key),args)}));
const locale=new URLSearchParams(location.search).get('locale')||'en', copy=getCopy(locale);
(window as any).evidenceCopy=copy;
document.documentElement.lang=locale;
function Host({source}:{source:ArchiveRecord}) {
  const worksheet=useComparisonWorksheet(source);
  const [decision,setDecision]=useState<DecisionInput|null>(null);
  return <section className="library folder-workspace" data-focused="true"><div className="folder-columns"><div className="folder-detail">
    {decision ? <DecisionWorkspace embedded copy={copy} locale={locale} initialSource={source} initialDraft={decision}
      onArchives={()=>setDecision(null)} onClose={()=>{}} /> : <ManualComparison copy={copy} record={source}
      sources={source.results.map((_,i)=>excerptSource(source,i)!)} worksheet={worksheet} busy={false}
      onCreate={(_,draft)=>setDecision(draft)} />}
  </div></div></section>;
}
bridge.call('getArchive',[]).then((source:ArchiveRecord)=>createRoot(document.getElementById('root')!).render(<Host source={source}/>));
