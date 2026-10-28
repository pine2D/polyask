import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { QuestionHistory } from '../../src/renderer/question-history';
import { ArchiveSurface } from '../../src/renderer/archive-surface';
import { FeedbackProvider } from '../../src/renderer/feedback-provider';
import { setShellApi } from '../../src/renderer/shell-api';
import { getCopy } from '../../src/shared/copy';
import { withFolderPages } from './library-page-api';
import '../../src/renderer/styles.css';
import '../../src/renderer/accessibility.css';
import '../../src/renderer/feedback.css';
const params = new URLSearchParams(location.search), locale = params.get('locale') ?? 'en', copy = getCopy(locale);
const noop = () => {}, mode = params.get('mode') ?? 'history';
document.documentElement.lang = locale;
async function start() {
  const data = await window.polyask.bootstrap() as any;
  const api = window.polyask;
  setShellApi(withFolderPages({ ...api, setQuestionPanel: async () => {}, setSurface: noop, onQuestionSaveFailed: () => noop,
    onQuestionAttachmentSaveFailed: () => noop, listLegacyQuestions: async () => ({ items: [], cursor: null }),
    listQuestions: async () => ({ items: data.questions.map((q: any) => ({ ...q, savedSites: 2, answers: data.answers.filter((a: any) => a.questionId === q.id) })), cursor: null }),
    getQuestion: async (id: string, answerId?: string) => { const answers = data.answers.filter((a: any) => a.questionId === id);
      const selected = answerId ?? answers[1].id; return { question: data.questions.find((q: any) => q.id === id), loadedAnswerId: selected,
        answers: answers.map((a: any) => ({ ...a, answerMarkdown: a.id === selected ? a.answerMarkdown : null })) }; },
    listFolders: async () => [], listArchiveTags: async () => [], getArchive: async (id: string) => data.archives.find((r: any) => r.id === id),
    searchFolderContents: async () => [...data.archives.map((record: any) => ({ kind: 'archive', record })), { kind: 'decision', record: data.decision }],
    getDecision: async () => data.decision
  }) as any);
  (window as any).markdownFixture = { copy, ready: true, keys: [] };
  window.addEventListener('keydown', e => (window as any).markdownFixture.keys.push({ key: e.key, trusted: e.isTrusted }));
  function App() {
    const [open, setOpen] = useState(true);
    return <FeedbackProvider copy={copy}>{mode === 'history' ? <QuestionHistory open={open} copy={copy} locale={locale}
      sites={[{ key: 'claude', label: 'Claude' }, { key: 'chatgpt', label: 'ChatGPT' }] as any} draft="" busy={false}
      onBlockingChange={noop} onOpen={() => setOpen(true)} onClose={() => setOpen(false)} onDraft={noop} />
      : <ArchiveSurface copy={copy} locale={locale} preferredId={mode === 'bulk' ? null : data.archives[0].id} sites={[]} synthesisSites={[]} defaultTier={null}
        pendingSynthesis={null} synthesisCandidate={null} onClose={noop} onCapture={async () => data.archives[0]}
        onSendSynthesis={async () => {}} onCollectSynthesis={async () => {}} onSaveSynthesis={async () => data.archives[0]} />}</FeedbackProvider>;
  }
  createRoot(document.getElementById('root')!).render(<App />);
}
void start();
