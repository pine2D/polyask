import { withFolderPages } from './library-page-api';
import React, { useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ArchiveSurface } from '../../src/renderer/archive-surface';
import { ExclusiveActionLock } from '../../src/renderer/broadcast-flow-state';
import { createComparisonDraftStore } from '../../src/renderer/comparison-draft-store';
import { FeedbackProvider } from '../../src/renderer/feedback-provider';
import { createLibrarySessionStore } from '../../src/renderer/library-session';
import { setShellApi } from '../../src/renderer/shell-api';
import { useSynthesisFlow } from '../../src/renderer/use-synthesis-flow';
import { useSynthesisRecovery } from '../../src/renderer/use-synthesis-recovery';
import { SITES } from '../../src/main/sites';
import { updateArchiveRecord, type ArchiveRecord, type ArchivePatch } from '../../src/shared/archive';
import { getCopy } from '../../src/shared/copy';
import type { DecisionInput } from '../../src/shared/decision';
import { validateSynthesisRequest, type PendingSynthesis, type SynthesisCandidate, type SynthesisSendRequest } from '../../src/shared/synthesis';
import { nativeArchive, nativeOther } from './reading-analysis-data';
import '../../src/renderer/styles.css';

const query = new URLSearchParams(location.search), locale = query.get('locale') || 'en', mode = query.get('mode') || 'comparison';
document.documentElement.lang = locale;
const copy = getCopy(locale);
let records: ArchiveRecord[] = [nativeArchive, nativeOther], writeCount = 0, decisionWrites = 0, sendCount = 0;
let lastDecision: DecisionInput | null = null, lastRequest: SynthesisSendRequest | null = null;
let pending: PendingSynthesis | null = null, candidate: SynthesisCandidate | null = null;
let readDelay = false, uncertain = false;
const reads: (() => void)[] = [];
const originalRequirement = 'Original saved requirement: verify sources before using the analysis.';
const saved = { host: SITES[0].host, text: 'Saved supplementary analysis with an unverified [S1] reference.',
  state: 'think' as const, instruction: originalRequirement, createdAt: 1700000000020 };
if (mode === 'saved') records[0] = { ...nativeArchive, synthesis: saved };
setShellApi(withFolderPages({
  listFolders: async () => [], listArchiveTags: async () => [],
  searchFolderContents: async () => records.map(record => ({ kind: 'archive', record })),
  getArchive: async (id: string) => { const value = records.find(record => record.id === id) || null;
    if (readDelay) await new Promise<void>(resolve => reads.push(resolve)); return value; },
  updateArchive: async (id: string, patch: ArchivePatch) => {
    writeCount++; const value = updateArchiveRecord(records.find(record => record.id === id)!, patch,
      { now: 1700000000100 + writeCount, deviceId: 'fixture' });
    records = records.map(record => record.id === id ? value : record); return value;
  },
  createDecision: async (input: DecisionInput) => { decisionWrites++; lastDecision = input;
    return { ...input, id: 'native-decision', sourceTitle: nativeArchive.task,
      evidence: input.evidence.map(item => ({ ...item, host: nativeArchive.results[item.resultIndex].host,
        label: nativeArchive.results[item.resultIndex].label, capturedAt: nativeArchive.ts })),
      schema: 2, createdAt: 1700000000100, updatedAt: 1700000000100, deviceId: 'fixture' }; },
  sendSynthesis: async (request: SynthesisSendRequest) => {
    sendCount++; lastRequest = request;
    const record = records.find(record => record.id === request.archiveId)!;
    const invalid = validateSynthesisRequest(request, record);
    if (invalid || uncertain) return { result: { site: request.targetSite, ok: false, code: invalid || 'submit_unconfirmed' }, pending: null };
    pending = { archiveId: record.id, targetSite: request.targetSite, targetHost: SITES.find(site => site.key === request.targetSite)!.host,
      tier: request.tier, instruction: request.instruction, sentAt: 1700000000200 + sendCount };
    return { result: { site: request.targetSite, ok: true }, pending };
  },
  collectSynthesis: async () => { if (!pending) throw new Error('synthesis_not_pending');
    candidate = { host: pending.targetHost, text: 'Collected analysis awaiting an explicit save. [S1] is unverified.',
      state: pending.tier, instruction: pending.instruction, createdAt: 1700000000300 }; return candidate; },
  saveSynthesis: async () => { if (!pending || !candidate) throw new Error('synthesis_not_pending');
    writeCount++; const record = { ...records.find(record => record.id === pending!.archiveId)!, synthesis: candidate, updatedAt: 1700000000400 };
    records = records.map(old => old.id === record.id ? record : old); pending = null; candidate = null; return record; },
  cancel: () => {}, openExternal: async () => {}
}) as any);
let controls: { revise: () => void; recovered: () => void };
function App() {
  const [open, setOpen] = useState(true), [revision, setRevision] = useState(1);
  const lock = useRef(new ExclusiveActionLock()), session = useRef(createLibrarySessionStore()), comparison = useRef(createComparisonDraftStore());
  const flow = useSynthesisFlow(lock.current);
  const recovery = useSynthesisRecovery(copy, flow, () => setOpen(false), () => { setOpen(true); setRevision(value => value + 1); });
  controls = { revise: () => { records[0] = { ...records[0], updatedAt: records[0].updatedAt + 1,
    results: records[0].results.map((result, index) => index === 0 ? { ...result, text: result.text + '\r\nSource revision.' } : result) }; },
    recovered: () => flow.acceptPending(pending) };
  return <>
    {!open ? <button data-fixture-reopen onClick={() => { setOpen(true); setRevision(value => value + 1); }}>{copy.archiveTitle}</button> : null}
    {open ? <div className="surface-stage"><ArchiveSurface copy={copy} locale={locale} preferredId={nativeArchive.id} comparisonId={mode === 'comparison' ? nativeArchive.id : null}
      navigationRevision={revision} session={session.current} comparisonDrafts={comparison.current} sites={SITES} synthesisSites={SITES}
      defaultTier="think" synthesisDrafts={flow.drafts} synthesisEditorRequest={recovery.editorRequest} onSynthesisEditorOpened={recovery.consumeEditorRequest}
      pendingSynthesis={flow.pending} synthesisCandidate={flow.candidate} synthesisSession={flow.session} onClose={() => setOpen(false)}
      onCapture={async () => { throw new Error('unexpected_capture'); }} onSendSynthesis={recovery.send}
      onCollectSynthesis={async () => { await flow.collect(); }} onSaveSynthesis={flow.save} /></div> : null}
  </>;
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><FeedbackProvider copy={copy}><App /></FeedbackProvider></React.StrictMode>);
(window as any).readingFixture = {
  labels: copy, siteLabel: (key: string) => SITES.find(site => site.key === key)?.label,
  originalRequirement, sources: nativeArchive.results,
  readDelay: (value: boolean) => { readDelay = value; }, resolveReads: () => { reads.splice(0).forEach(resolve => resolve()); },
  uncertain: (value: boolean) => { uncertain = value; }, revise: () => controls.revise(), recover: () => controls.recovered(),
  state: () => ({ writeCount, decisionWrites, sendCount, pending: !!pending, saved: !!records[0].synthesis,
    requestVersionCurrent: lastRequest?.sourceUpdatedAt === records[0].updatedAt,
    excerptExact: !!lastRequest?.excerpt && nativeArchive.results.some(result => result.text!.includes(lastRequest!.excerpt!)),
    excerptLength: lastRequest?.excerpt?.length ?? 0, selectedCount: lastRequest?.selectedHosts.length ?? 0,
    decisionEvidenceExact: lastDecision?.evidence.every(item => nativeArchive.results[item.resultIndex].text!.includes(item.excerpt)) ?? false,
    decisionEvidenceCount: lastDecision?.evidence.length ?? 0,
    decisionEvidenceIndex: lastDecision?.evidence[0]?.resultIndex ?? -1, decisionManual: lastDecision?.conclusion === 'My manual judgment.',
    waitingReads: reads.length, requirementExact: records[0].synthesis?.instruction === lastRequest?.instruction })
};
