import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ArchiveSurface } from '../../src/renderer/archive-surface';
import { ArchiveMetadata } from '../../src/renderer/archive-metadata';
import { DecisionWorkspace } from '../../src/renderer/decision-workspace';
import { FolderMembershipDialog } from '../../src/renderer/folder-membership-dialog';
import { FeedbackProvider } from '../../src/renderer/feedback-provider';
import { setShellApi } from '../../src/renderer/shell-api';
import { getCopy } from '../../src/shared/copy';
import { updateArchiveRecord } from '../../src/shared/archive';
import type { DecisionInput } from '../../src/shared/decision';
import { SITES } from '../../src/main/sites';
import { nativeArchive } from './reading-analysis-data';
import { withFolderPages } from './library-page-api';
import '../../src/renderer/styles.css';
import '../../src/renderer/settings.css';
import '../../src/renderer/accessibility.css';
import '../../src/renderer/feedback.css';

const query = new URLSearchParams(location.search), locale = query.get('locale') || 'en', mode = query.get('mode') || 'read';
const copy = getCopy(locale), counts = { metadata: 0, create: 0, membership: 0, decision: 0 };
const existing = { id: 'existing', name: 'Reviewed sources', schema: 3 as const, deviceId: 'fixture', createdAt: 1, updatedAt: 1 };
let holding = false;
const waits: (() => void)[] = [];
const attempt = async (kind: keyof typeof counts) => {
  const number = ++counts[kind];
  if (holding) await new Promise<void>(resolve => waits.push(resolve));
  else await new Promise(resolve => setTimeout(resolve, 80));
  if (number === 1) throw new Error('synthetic_failure');
};
const records = Array.from({ length: 30 }, (_, index) => ({ ...nativeArchive, id: index ? `other-${index}` : nativeArchive.id }));
setShellApi(withFolderPages({ listFolders: async () => [], listArchiveTags: async () => [],
  searchFolderContents: async () => records.map(record => ({ kind: 'archive', record })), getArchive: async () => nativeArchive,
  folderMemberships: async () => [], createFolder: async (name: string) => { await attempt('create'); return { ...existing, id: 'new', name }; },
  patchFolderMemberships: async () => { await attempt('membership'); return ['existing', 'new']; },
  createDecision: async (value: DecisionInput) => { await attempt('decision'); return { ...value, id: 'new-card', schema: 2,
    sourceTitle: nativeArchive.task, createdAt: 1, updatedAt: 1, deviceId: 'fixture', evidence: [] }; }
}) as any);
(window as any).recoveryFixture = { copy, counts, hold: () => { holding = true; }, release: () => { holding = false; waits.splice(0).forEach(resolve => resolve()); } };
document.documentElement.lang = locale;
function App() {
  const [record, setRecord] = useState(nativeArchive), [organizing, setOrganizing] = useState(false);
  if (mode === 'read' || mode === 'compare') return <div className="surface-stage"><ArchiveSurface copy={copy} locale={locale}
    preferredId={record.id} comparisonId={mode === 'compare' ? record.id : null} sites={SITES} synthesisSites={SITES} defaultTier={null}
    pendingSynthesis={null} synthesisCandidate={null} onClose={() => {}} onCapture={async () => record}
    onSendSynthesis={async () => {}} onCollectSynthesis={async () => {}} onSaveSynthesis={async () => record} /></div>;
  return <section className="folder-workspace library" data-focused="true"><div className="folder-columns"><div className="folder-detail">
    {mode === 'decision' ? <DecisionWorkspace copy={copy} locale={locale} embedded initialSource={record} onArchives={() => {}} onClose={() => {}} />
      : <><article className="archive-detail"><ArchiveMetadata copy={copy} record={record} busy={false} onSave={async patch => {
        await attempt('metadata'); setRecord(updateArchiveRecord(record, patch, { now: record.updatedAt + 1, deviceId: 'fixture' })); return true;
      }} /><button id="organize" onClick={() => setOrganizing(true)}>{copy.folderMembership}</button><button id="outside">Outside action</button></article>
      {organizing && <FolderMembershipDialog copy={copy} target={{ kind: 'archive', id: record.id }} targetTitle={record.task}
        folders={[existing]} onCancel={() => setOrganizing(false)} onSaved={() => setOrganizing(false)} />}</>}
  </div></div></section>;
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><FeedbackProvider copy={copy}><App /></FeedbackProvider></React.StrictMode>);
