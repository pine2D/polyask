// Synthetic guide state only: no Electron bridge, real profile, server reads, health probes or sends.
import React, { useLayoutEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { SITES } from '../../src/main/sites';
import { COMMANDS } from '../../src/shared/commands';
import { getCopy } from '../../src/shared/copy';
import { DEFAULT_DISPLAY_PREFERENCES } from '../../src/shared/display';
import type { QuestionRunProgress } from '../../src/shared/question-run-progress';
import { GettingStarted } from '../../src/renderer/getting-started';
import { useWorkbenchGuide, type GuideNavigationRequest } from '../../src/renderer/use-workbench-guide';
import { WorkbenchGuideInvite, WorkbenchGuidePanel } from '../../src/renderer/workbench-guide';
import '../../src/renderer/styles.css';

const locale = new URLSearchParams(location.search).get('locale') ?? 'en', copy = getCopy(locale);
document.documentElement.lang = locale;
const partial: QuestionRunProgress = { runId: 'fixture-run', questionId: 'fixture-question', revision: 1, state: 'available',
  answers: (['claude', 'kimi'] as const).map(site => ({ id: `${site}-1`, site, attempt: 1, submission: 'submitted',
    capture: 'partial', hasText: true, truncated: false, sealedAt: null })) };
const trace: { checked: string[][]; focused: string[]; commands: string[]; navigations: GuideNavigationRequest[]; failures: number } =
  { checked: [], focused: [], commands: [], navigations: [], failures: 0 };
function SavedReader({ request, ready, onReady }: { request: GuideNavigationRequest; ready: boolean; onReady: () => void }) {
  useLayoutEffect(() => { if (ready) onReady(); }, [ready, request.request]);
  return <article data-guide-fixture-reader={ready ? 'ready' : 'loading'} data-question-id={request.questionId}
    data-answer-id={request.answerIds[0]}>{ready ? 'Synthetic saved partial answer: exact fixture question and attempt.' : 'Loading saved fixture copy'}</article>;
}
function Fixture() {
  const [details, setDetails] = useState(false), [manual, setManual] = useState(false);
  const [progress, setProgress] = useState<QuestionRunProgress | null>(null);
  const [request, setRequest] = useState<GuideNavigationRequest | null>(null), [readReady, setReadReady] = useState(false);
  const guide = useWorkbenchGuide({ storage: localStorage, fallbackDisplay: DEFAULT_DISPLAY_PREFERENCES,
    ready: true, busy: false, participating: ['claude', 'kimi'], runId: progress?.runId ?? null,
    activeSites: progress ? ['claude', 'kimi'] : [], statuses: {}, progress,
    onPersistenceFailure: () => { trace.failures++; },
    onNavigate: value => { trace.navigations.push(value); setRequest(value); setReadReady(false); } });
  useLayoutEffect(() => {
    const ready = () => setReadReady(true);
    document.addEventListener('fixture:guide-read-ready', ready);
    return () => document.removeEventListener('fixture:guide-read-ready', ready);
  }, []);
  (window as unknown as { guideFixture: unknown }).guideFixture = { result: () => trace };
  return <main className="workbench-guide-fixture" data-guide-stage={guide.model.stage}>
    <div className="workspace-progress" style={{ height: 32 }}>
      {!progress && <WorkbenchGuideInvite copy={copy} model={guide.model} onOpen={() => setDetails(true)} onDismiss={() => { guide.dismiss(); }} />}
    </div>
    <div style={{ position: 'absolute', left: 350, top: 80 }}>
      <button type="button" style={{ minHeight: 32 }} data-guide-fixture="manual" onClick={() => setManual(true)}>{copy.gettingStarted}</button>
      <button type="button" style={{ minHeight: 32 }} data-guide-fixture="partial" onClick={() => { setProgress(partial); setDetails(true); }}>Load synthetic partial-copy progress</button>
      {manual && <GettingStarted copy={copy} commands={COMMANDS} onExecute={id => trace.commands.push(id)} />}
      {request && <SavedReader request={request} ready={readReady} onReady={() => guide.acknowledgeRead(request.questionId, request.request)} />}
    </div>
    {details && <aside className="workspace-drawer" data-state="open"><WorkbenchGuidePanel copy={copy} model={guide.model} sites={SITES}
      health={{ kimi: { site: 'kimi', state: 'sign-in', checks: [] } }} statuses={{}} pending={guide.pendingNavigation !== null}
      onChooseSites={() => trace.commands.push('open-sites')} onCheckSites={sites => trace.checked.push([...sites])}
      onFocusSite={site => trace.focused.push(site)} onFocusPrompt={() => trace.commands.push('focus-prompt')}
      onRead={() => { guide.navigate('read'); }} onCompare={() => { guide.navigate('compare'); }} onDismiss={() => { guide.dismiss(); }} /></aside>}
  </main>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
