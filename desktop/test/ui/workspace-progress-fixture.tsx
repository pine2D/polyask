import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import { WorkspaceProgress } from '../../src/renderer/workspace-progress';
import { QuestionHistory } from '../../src/renderer/question-history';
import { FeedbackProvider } from '../../src/renderer/feedback-provider';
import { useQuestionRunProgress } from '../../src/renderer/use-question-run-progress';
import { setShellApi } from '../../src/renderer/shell-api';
import { applyDisplayDensity } from '../../src/renderer/display-preferences';
import { getCopy } from '../../src/shared/copy';
import { SITE_KEYS } from '../../src/shared/contracts';
import { SITES } from '../../src/main/sites';
import type { QuestionRunProgress } from '../../src/shared/question-run-progress';
import type { SiteStatus } from '../../src/shared/protocol';
import '../../src/renderer/styles.css';

const query = new URLSearchParams(location.search), copy = getCopy(query.get('locale') || 'en');
applyDisplayDensity(document.documentElement, { density: query.get('density') === 'comfortable' ? 'comfortable' : 'compact', siteScale: 1 });
let progress: QuestionRunProgress = { runId: 'current', questionId: 'question', revision: 1, state: 'available', answers: [] };
let push: (value: QuestionRunProgress) => void = () => undefined, reads = 0, live = 0;
let controls: { evidence: (mode: string) => void; expanded: (value: boolean) => void };
const question = { schema: 4 as const, id: 'question', sites: ['claude', 'kimi'] as const, text: 'Synthetic saved question',
  requestedTier: null, inputImageCount: 0, createdAt: 100, updatedAt: 100, deviceId: 'fixture' };
const bodies = ['Saved Claude body', 'Saved Kimi body'];
setShellApi({ getQuestionRunProgress: async () => progress, onQuestionRunProgress: (handler: typeof push) => { push = handler; return () => {}; },
  onSyncStatus: () => () => {}, setQuestionPanel: async () => {}, setSurface: () => {}, onQuestionSaveFailed: () => () => {},
  listLegacyQuestions: async () => ({ items: [], cursor: null }), listQuestions: async () => ({ items: [], cursor: null }),
  getQuestion: async (id: string, answerId?: string) => { reads++; return { question, loadedAnswerId: answerId,
    answers: ['claude', 'kimi'].map((site, index) => ({ schema: 4, id: `answer-${site}`, questionId: id, site, attempt: 1,
      submission: 'submitted', submissionCode: null, capture: 'partial', captureCode: null, answerMarkdown: answerId === `answer-${site}` ? bodies[index] : null,
      conversationUrl: null, capturedAt: 100, sealedAt: null, truncated: false, createdAt: 100, updatedAt: 100, deviceId: 'fixture' })) }; },
  collectAnswers: async () => { live++; return []; }, broadcast: async () => { live++; return []; }
} as any);
function Fixture() {
  const flow = useQuestionRunProgress('current'), [statuses, setStatuses] = useState<Record<string, SiteStatus>>({});
  const [page, setPage] = useState(0), [expanded, setExpanded] = useState(false), [open, setOpen] = useState(false);
  const [request, setRequest] = useState<{ request: number; questionId: string; answerId: string } | null>(null);
  controls = { expanded: setExpanded, evidence: mode => {
    const answer = { id: 'answer-claude', site: 'claude' as const, attempt: 1, submission: 'submitted' as const,
      capture: mode === 'full' ? 'complete' as const : 'partial' as const, hasText: mode !== 'waiting', truncated: false, sealedAt: mode === 'full' ? 100 : null };
    progress = { ...progress, revision: progress.revision + 1, answers: [answer] }; push(progress);
    setStatuses({ claude: { site: 'claude', phase: 'complete', submission: { runId: 'current', state: 'sent' }, generation: { runId: 'current', state: 'complete' } },
      chatgpt: { site: 'chatgpt', phase: 'failed', submission: { runId: 'old', state: 'failed' } },
      kimi: { site: 'kimi', phase: 'failed', submission: { runId: 'current', state: 'unconfirmed' } },
      deepseek: { site: 'deepseek', phase: 'cancelled', submission: { runId: 'current', state: 'cancelled' } } });
  } };
  return <FeedbackProvider copy={copy}><main className={`app-shell${expanded ? ' is-composer-expanded' : ''}`}>
    <div style={{ height: expanded ? query.get('density') === 'comfortable' ? 144 : 120 : query.get('density') === 'comfortable' ? 64 : 52 }}/>
    <WorkspaceProgress copy={copy} sites={SITES} selectedSites={SITE_KEYS} statuses={statuses} page={page} inputMethod="keyboard"
      runId="current" activeSites={['claude', 'kimi', 'deepseek']} progress={flow.value} onPageChange={setPage}
      onRead={() => { setRequest({ request: (request?.request ?? 0) + 1, questionId: 'question', answerId: 'answer-claude' }); setOpen(true); }}/>
    <QuestionHistory open={open} openRequest={request} copy={copy} sites={SITES} draft="" busy={false}
      onBlockingChange={() => {}} onOpen={() => setOpen(true)} onClose={() => setOpen(false)} onDraft={() => {}}/>
  </main></FeedbackProvider>;
}
(window as any).progressFixture = { evidence: (mode: string) => controls.evidence(mode), expanded: (value: boolean) => controls.expanded(value), state: () => ({ reads, live }) };
createRoot(document.getElementById('root')!).render(<Fixture/>);
