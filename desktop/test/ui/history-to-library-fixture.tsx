import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ArchiveSurface } from '../../src/renderer/archive-surface';
import { FeedbackProvider } from '../../src/renderer/feedback-provider';
import { QuestionHistory } from '../../src/renderer/question-history';
import { setShellApi } from '../../src/renderer/shell-api';
import { createArchiveRecord, type ArchiveRecord } from '../../src/shared/archive';
import { getCopy, formatCopy } from '../../src/shared/copy';
import { projectQuestionArchiveInput, type QuestionArchiveRequest } from '../../src/shared/question-archive';
import type { QuestionDetail } from '../../src/shared/question-history';
import type { FolderMembershipChange, FolderTarget, TaskFolder } from '../../src/shared/task-folder';
import { historySites, originalPrompt, savedDetail } from './history-to-library-data';
import '../../src/renderer/styles.css';

const locale = new URLSearchParams(location.search).get('locale') || 'en';
document.documentElement.lang = locale;
const copy = getCopy(locale);
// 原生回归控制只读回包顺序，不等待五秒轮询。
window.setInterval = (() => 0) as unknown as typeof window.setInterval;
window.clearInterval = () => {};
const archives: ArchiveRecord[] = [];
const folders: TaskFolder[] = [{ schema: 3, id: 'fixture-folder', name: 'Review folder',
  createdAt: 1700000000000, updatedAt: 1700000000000, deviceId: 'fixture' }];
const requests: QuestionArchiveRequest[] = [];
const reads: { id: string; resolve: () => void; reject: () => void }[] = [];
let delayReads = false, delayCreate = false, failCreate = false, createReply: (() => void) | null = null;
let captures = 0, drafted = '', blocking = false, folderTarget = '', folderIds: string[] = [];
let appControls: { reopen: () => void; busy: (value: boolean) => void };
const loaded = (answerId = 'a2'): QuestionDetail => ({ ...savedDetail, loadedAnswerId: answerId,
  answers: savedDetail.answers.map(answer => ({ ...answer, answerMarkdown: answer.id === answerId ? answer.answerMarkdown : null })) });
setShellApi({
  setQuestionPanel: async () => {}, setSurface: async () => {}, onQuestionSaveFailed: () => () => {},
  listLegacyQuestions: async () => ({ items: [], cursor: null }),
  listQuestions: async () => ({ items: [{ ...savedDetail.question, savedSites: 2, answers: savedDetail.answers }], cursor: null }),
  getQuestion: async (_id: string, answerId = 'a2') => {
    const value = loaded(answerId);
    if (delayReads) await new Promise<void>((resolve, reject) => reads.push({ id: answerId, resolve, reject: () => reject(new Error('capture_failed')) }));
    return value;
  },
  createQuestionArchive: async (request: QuestionArchiveRequest) => {
    requests.push(request);
    if (failCreate) { failCreate = false; throw new Error('history_not_found'); }
    const selected = savedDetail.answers.filter(answer => request.answers.some(item => item.answerId === answer.id));
    const record = createArchiveRecord(projectQuestionArchiveInput(savedDetail.question, selected, historySites, request.locale),
      { id: `history-result-${archives.length + 1}`, now: 1700000010000 + archives.length, deviceId: 'fixture' });
    archives.push(record);
    if (delayCreate) await new Promise<void>(resolve => { createReply = resolve; });
    return record;
  },
  collectAnswers: async () => { captures++; throw new Error('unexpected_live_capture'); },
  addArchive: async () => { captures++; throw new Error('unexpected_current_page_archive'); },
  listFolders: async () => folders,
  listArchiveTags: async () => [],
  searchFolderContents: async () => archives.map(record => ({ kind: 'archive', record })),
  getArchive: async (id: string) => archives.find(record => record.id === id) || null,
  folderMemberships: async () => [],
  patchFolderMemberships: async (target: FolderTarget, changes: FolderMembershipChange[]) => {
    folderTarget = `${target.kind}:${target.id}`; folderIds = changes.filter(item => item.present).map(item => item.folderId); return [];
  },
  openExternal: async () => {}
} as any);
function App() {
  const [open, setOpen] = useState(true), [busy, setBusy] = useState(false);
  const [route, setRoute] = useState<{ record: ArchiveRecord; mode: 'read' | 'compare' } | null>(null);
  appControls = { reopen: () => { setRoute(null); setOpen(true); }, busy: setBusy };
  return <FeedbackProvider copy={copy}>
    <QuestionHistory open={open} copy={copy} sites={historySites} draft="" busy={busy} locale={locale}
      onBlockingChange={value => { blocking = value; }} onOpen={() => setOpen(true)} onClose={() => setOpen(false)}
      onDraft={text => { drafted = text; }} onArchiveCreated={(record, mode) => { setOpen(false); setRoute({ record, mode }); }} />
    {route && <ArchiveSurface copy={copy} locale={locale} preferredId={route.record.id}
      comparisonId={route.mode === 'compare' ? route.record.id : null} sites={historySites} synthesisSites={historySites}
      defaultTier="think" pendingSynthesis={null} synthesisCandidate={null} onClose={appControls.reopen}
      onCapture={async () => { captures++; throw new Error('unexpected_live_capture'); }} onSendSynthesis={async () => {}}
      onCollectSynthesis={async () => {}} onSaveSynthesis={async () => route.record} />}
  </FeedbackProvider>;
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
(window as any).historyFixture = {
  labels: { copyPrompt: copy.questionCopyPrompt, reask: copy.questionReask, answerCopy: copy.questionCopy,
    loading: copy.questionAnswerLoading, failed: copy.questionAnswerFailed, copied: copy.questionPromptCopied, copyFailed: copy.questionFailed },
  prompt: originalPrompt,
  readDelay: (value: boolean) => { delayReads = value; },
  resolveRead: (id: string) => { const index = reads.findIndex(read => read.id === id); if (index < 0) throw new Error('no_pending_read'); reads.splice(index, 1)[0].resolve(); },
  rejectRead: (id: string) => { const index = reads.findIndex(read => read.id === id); if (index < 0) throw new Error('no_pending_read'); reads.splice(index, 1)[0].reject(); },
  createDelay: (value: boolean) => { delayCreate = value; },
  createFail: () => { failCreate = true; },
  resolveCreate: () => { createReply?.(); createReply = null; },
  reopen: () => appControls.reopen(), busy: (value: boolean) => appControls.busy(value),
  state: () => ({ captures, blocking, draftExact: drafted === originalPrompt, requests: requests.length,
    selectedIds: requests.at(-1)?.answers.map(item => item.answerId).join(',') || '', folderTarget, folderIds: folderIds.join(','),
    archiveCount: archives.length, sourceNull: archives.every(record => record.source === null),
    promptExact: archives.every(record => record.text === originalPrompt),
    bodiesExact: archives.every(record => record.results.every(result => savedDetail.answers.some(answer =>
      answer.answerMarkdown === result.text && historySites.find(site => site.key === answer.site)?.host === result.host))),
    oldIdentity: archives.at(-1)?.results[0]?.label.includes(formatCopy(copy.questionAttempt, { number: 1 })) || false,
    oldTruncated: archives.at(-1)?.results[0]?.code === 'answer_truncated',
    resultCount: archives.at(-1)?.results.length || 0,
    hosts: archives.at(-1)?.results.map(result => result.host).join(',') || '' })
};
