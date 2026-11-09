import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ArchiveSurface } from '../../src/renderer/archive-surface';
import { QuestionHistory } from '../../src/renderer/question-history';
import { FeedbackProvider } from '../../src/renderer/feedback-provider';
import { setShellApi } from '../../src/renderer/shell-api';
import { getCopy } from '../../src/shared/copy';
import { createArchiveRecord } from '../../src/shared/archive';
import type { FolderContent } from '../../src/shared/task-folder';
import type { QuestionRecord } from '../../src/shared/question-history';
import { historySites, savedDetail } from './history-to-library-data';
import { pageFolderContents } from './library-page-api';
import '../../src/renderer/styles.css';
import '../../src/renderer/accessibility.css';
import '../../src/renderer/feedback.css';

const params = new URLSearchParams(location.search), locale = params.get('locale') || 'en', copy = getCopy(locale);
document.documentElement.lang = locale;
const titles = locale === 'en' ? ['Compare sources and preserve the original evidence', 'Review the decision before the next meeting']
  : locale === 'zh-TW' ? ['比較不同來源的回答，保留原始資料供後續查核', '下次會議前需要重新核對的決策卡']
  : ['比较不同来源的回答，保留原始资料以便继续核对', '下次会议前需要重新核对的决策卡'];
const items: FolderContent[] = Array.from({ length: 8 }, (_, i) => ({ kind: 'archive', record: { ...createArchiveRecord({
  text: titles[0], task: `${titles[0]} ${i + 1}`, results: [{ host: 'claude.ai', label: 'Claude', text: ('## Saved answer\n\nOriginal source text.\n\n').repeat(15) }]
}, { id: `a-${i}`, now: 1700000000000 - i, deviceId: 'fixture' }), favorite: i === 0 } }));
items.splice(1, 0, { kind: 'decision', record: { schema: 7, id: 'd-1', archiveId: 'a-0', sourceTitle: titles[0],
  title: titles[1], conclusion: 'Review the evidence.', rationale: '', uncertainties: '', nextStep: '', status: 'draft',
  favorite: true, evidence: [], createdAt: 1699999999999, updatedAt: 1699999999999, deviceId: 'fixture' } });
const questions: QuestionRecord[] = Array.from({ length: 8 }, (_, i) => ({ ...savedDetail.question, id: `q-${i}`,
  text: `${titles[0]} ${i + 1}`, schema: 7, favorite: i === 0, createdAt: 1700000000000 - i, updatedAt: 1700000000000 - i }));
let fail = false, hold = false, pending: (() => void) | undefined, calls = 0;
async function write() {
  calls++;
  if (hold) await new Promise<void>(resolve => { pending = resolve; });
  if (fail) { fail = false; throw Error('synthetic_save_failure'); }
}
setShellApi({
  setQuestionPanel: async () => {}, setSurface: () => {}, onQuestionSaveFailed: () => () => {},
  listLegacyQuestions: async () => ({ items: [], cursor: null }),
  listQuestions: async (filters: any) => ({ cursor: null, items: questions.filter(q => (!filters.favorite || q.favorite) && (!filters.query || q.text.includes(filters.query)))
    .map(q => ({ ...q, savedSites: 2, answers: savedDetail.answers })) }),
  getQuestion: async (id: string, answerId?: string) => ({ ...savedDetail, question: questions.find(q => q.id === id),
    answers: savedDetail.answers.map(answer => ({ ...answer, questionId: id })), loadedAnswerId: answerId ?? savedDetail.loadedAnswerId }),
  setQuestionFavorite: async (id: string, favorite: boolean) => {
    await write(); const index = questions.findIndex(q => q.id === id);
    return questions[index] = { ...questions[index], favorite, updatedAt: Date.now() };
  },
  listFolders: async () => [], listArchiveTags: async () => [],
  queryFolderContents: async (request: any) => pageFolderContents(items.filter(item => (!request.kind || item.kind === request.kind)
    && (!request.favorite || item.record.favorite) && (!request.query || JSON.stringify(item.record).includes(request.query))), request),
  getArchive: async (id: string) => items.find(item => item.kind === 'archive' && item.record.id === id)?.record ?? null,
  getDecision: async (id: string) => items.find(item => item.kind === 'decision' && item.record.id === id)?.record ?? null,
  updateArchive: async (id: string, patch: any) => {
    await write(); const index = items.findIndex(item => item.kind === 'archive' && item.record.id === id);
    items[index] = { ...items[index], record: { ...items[index].record, ...patch, updatedAt: Date.now() } };
    return items[index].record;
  },
  setDecisionFavorite: async (id: string, favorite: boolean) => {
    await write(); const index = items.findIndex(item => item.kind === 'decision' && item.record.id === id);
    items[index] = { ...items[index], record: { ...items[index].record, favorite, updatedAt: Date.now() } } as FolderContent;
    return items[index].record;
  },
  listDrafts: async () => [], folderMemberships: async () => [], onDraftsChanged: () => () => {},
} as any);
function App() {
  const [open, setOpen] = useState(true);
  return <FeedbackProvider copy={copy}>{params.get('surface') === 'history'
    ? <QuestionHistory open={open} copy={copy} sites={historySites} draft="" busy={false} locale={locale}
      onBlockingChange={() => {}} onOpen={() => setOpen(true)} onClose={() => setOpen(false)} onDraft={() => {}} />
    : <ArchiveSurface preferredId={null} copy={copy} locale={locale} sites={historySites} synthesisSites={historySites} defaultTier={null}
      pendingSynthesis={null} synthesisCandidate={null} onClose={() => {}} onCapture={async () => { throw Error('no_capture'); }}
      onSendSynthesis={async () => {}} onCollectSynthesis={async () => {}} onSaveSynthesis={async () => { throw Error('no_synthesis'); }} />}</FeedbackProvider>;
}
(window as any).starsFixture = { labels: copy, fail: () => { fail = true; }, hold: () => { hold = true; },
  release: () => { hold = false; pending?.(); }, calls: () => calls };
createRoot(document.getElementById('root')!).render(<App />);
