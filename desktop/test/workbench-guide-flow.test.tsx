import assert from 'node:assert/strict';
import test from 'node:test';
import { act, useState } from 'react';
import { SITES } from '../src/main/sites';
import { getCopy } from '../src/shared/copy';
import { DEFAULT_DISPLAY_PREFERENCES } from '../src/shared/display';
import { createArchiveRecord } from '../src/shared/archive';
import type { QuestionRunProgress } from '../src/shared/question-run-progress';
import type { QuestionReadingRequest } from '../src/renderer/question-reading-request';
import { useWorkbenchGuideFlow } from '../src/renderer/use-workbench-guide-flow';
import { readLocalUiPreferences } from '../src/renderer/local-ui-preferences';
import { a2, b, detail, q } from './ui/history-dom';
import { mountDom } from './ui/dom-harness';
import { setShellApi } from '../src/renderer/shell-api';
import { FeedbackProvider } from '../src/renderer/feedback-provider';

test('guide comparison joins explicit saved-copy creation to actual matching archive entry before persistence', async () => {
  const oldCss = require.extensions['.css']; require.extensions['.css'] = () => {};
  const { QuestionHistory } = await import('../src/renderer/question-history');
  const values = new Map<string, string>(), writes: string[] = [], live: string[] = [], created: string[][] = [];
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { writes.push(key); values.set(key, value); } };
  const copy = getCopy('en');
  const archive = createArchiveRecord({ task: q.text, text: q.text, results: [a2, b].map(answer => ({ host: answer.site, label: answer.site, text: answer.answerMarkdown })) },
    { id: 'guide-archive', now: 10, deviceId: 'fixture' });
  setShellApi({ setSurface: () => {}, setQuestionPanel: async () => {}, onQuestionSaveFailed: () => () => {},
    listQuestions: async () => ({ items: [], cursor: null }), getQuestion: async (_id: string, answerId?: string) => detail(answerId),
    createQuestionArchive: async (input: { answers: Array<{ answerId: string }> }) => { created.push(input.answers.map(item => item.answerId)); return archive; },
    collect: async () => { live.push('collect'); }, broadcast: async () => { live.push('broadcast'); }
  } as any);
  let flow!: ReturnType<typeof useWorkbenchGuideFlow>, publish!: (value: QuestionRunProgress) => void;
  function Fixture() {
    const [progress, setProgress] = useState<QuestionRunProgress | null>(null); publish = setProgress;
    const [request, setRequest] = useState<QuestionReadingRequest | null>(null), [reading, setReading] = useState(false);
    flow = useWorkbenchGuideFlow({ copy, sites: SITES, health: {}, storage, fallbackDisplay: DEFAULT_DISPLAY_PREFERENCES,
      ready: true, busy: false, participating: ['claude', 'kimi'], runId: progress?.runId ?? null,
      activeSites: progress ? ['claude', 'kimi'] : [], statuses: {}, progress, onPersistenceFailure: () => { throw new Error('unexpected'); },
      onOpen: () => {}, onChooseSites: () => {}, onCheckSites: () => {}, onFocusSite: () => {}, onFocusPrompt: () => {},
      onNavigate: value => { setRequest({ ...value, source: 'guide', answerId: value.answerIds[0] }); setReading(true); } });
    return <>{flow.invite}{flow.panel}<QuestionHistory open={reading} openRequest={request} copy={copy} sites={SITES} draft="" busy={false}
      onOpen={() => {}} onClose={() => { flow.cancel(); setReading(false); }} onDraft={() => {}} onBlockingChange={() => {}}
      onReadAccepted={flow.readAccepted} onReadingCancelled={flow.cancel} onArchiveCreated={(record, mode, selection) => {
        flow.archiveCreated(record.id, mode, selection.questionId, selection.answerIds); setReading(false);
      }} /></>;
  }
  const h = await mountDom(<FeedbackProvider copy={copy}><Fixture /></FeedbackProvider>);
  try {
    await h.click(h.document.querySelector<HTMLButtonElement>('[data-guide-action="open"]')!);
    await act(async () => publish({ runId: 'run-a', questionId: q.id, revision: 1, state: 'available',
      answers: [a2, b].map(answer => ({ id: answer.id, site: answer.site, attempt: answer.attempt, submission: answer.submission,
        capture: answer.capture, hasText: true, truncated: answer.truncated, sealedAt: answer.sealedAt })) }));
    await h.click(h.document.querySelector<HTMLButtonElement>('[data-guide-action="compare"]')!);
    assert.equal(h.document.querySelector('.question-archive-picker') !== null, true);
    assert.equal(writes.length, 0); assert.equal(created.length, 0); assert.deepEqual(live, []);
    await h.click(h.document.querySelector<HTMLButtonElement>('[data-question-archive="compare"]')!);
    assert.deepEqual(created, [[a2.id, b.id]]); assert.equal(writes.length, 0);
    await act(async () => { flow.archiveEntered('other-archive', 'compare'); flow.archiveEntered(archive.id, 'read'); });
    assert.equal(writes.length, 0);
    await act(async () => flow.archiveEntered(archive.id, 'compare'));
    assert.deepEqual(readLocalUiPreferences(storage).workbenchGuide, { version: 1, disposition: 'completed' });
    assert.equal(writes.length, 1); assert.deepEqual(live, []);
  } finally {
    await h.close(); setShellApi(null); if (oldCss) require.extensions['.css'] = oldCss; else delete require.extensions['.css'];
  }
});
