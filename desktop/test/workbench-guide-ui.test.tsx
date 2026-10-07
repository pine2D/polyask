import assert from 'node:assert/strict';
import test from 'node:test';
import { act, useState } from 'react';
import { SITES } from '../src/main/sites';
import type { SiteKey } from '../src/shared/contracts';
import { getCopy } from '../src/shared/copy';
import { DEFAULT_DISPLAY_PREFERENCES } from '../src/shared/display';
import type { QuestionRunProgress } from '../src/shared/question-run-progress';
import { readLocalUiPreferences } from '../src/renderer/local-ui-preferences';
import { useWorkbenchGuide, type GuideNavigationRequest, type WorkbenchGuideOptions } from '../src/renderer/use-workbench-guide';
import { WorkbenchGuideInvite, WorkbenchGuidePanel } from '../src/renderer/workbench-guide';
import { mountDom } from './ui/dom-harness';

type Runtime = Omit<WorkbenchGuideOptions, 'storage' | 'fallbackDisplay' | 'onPersistenceFailure' | 'onNavigate'>;
const initial: Runtime = { ready: true, busy: false, participating: ['claude', 'kimi', 'gemini'],
  runId: null, activeSites: [], statuses: {}, progress: null };
function storageFixture() {
  const values = new Map<string, string>(), writes: string[] = [];
  let fail = false;
  return { values, writes, getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { if (fail) throw new Error('storage_failed'); writes.push(key); values.set(key, value); },
    fail: () => { fail = true; } };
}
function copies(complete = false): QuestionRunProgress {
  return { runId: 'run-a', questionId: 'question-a', revision: 1, state: 'available', answers:
    (['claude', 'kimi'] as const).map(site => ({ id: `${site}-1`, site, attempt: 1, submission: 'submitted' as const,
      capture: complete ? 'complete' as const : 'partial' as const, hasText: true, truncated: false, sealedAt: complete ? 10 : null })) };
}
async function fixture(runtime: Runtime = initial, storage = storageFixture()) {
  let guide!: ReturnType<typeof useWorkbenchGuide>, publish!: (runtime: Runtime) => void;
  const navigations: GuideNavigationRequest[] = [], checked: Array<readonly SiteKey[]> = [], focused: SiteKey[] = [];
  const effects: string[] = [];
  let failures = 0;
  function Fixture() {
    const [value, setValue] = useState(runtime); publish = setValue;
    guide = useWorkbenchGuide({ ...value, storage, fallbackDisplay: DEFAULT_DISPLAY_PREFERENCES,
      onPersistenceFailure: () => { failures++; }, onNavigate: request => navigations.push(request) });
    const copy = getCopy('en');
    return <><button id="external-focus">Keep focus</button>
      <WorkbenchGuideInvite copy={copy} model={guide.model} onOpen={() => effects.push('open-guide')} onDismiss={() => { guide.dismiss(); }} />
      <WorkbenchGuidePanel copy={copy} model={guide.model} sites={SITES} health={{ kimi: { site: 'kimi', state: 'sign-in', checks: [] } }}
        statuses={value.statuses} pending={guide.pendingNavigation !== null}
        onChooseSites={() => effects.push('open-sites')} onCheckSites={keys => checked.push(keys)}
        onFocusSite={site => focused.push(site)} onFocusPrompt={() => effects.push('focus-prompt')}
        onRead={() => { guide.navigate('read'); }} onCompare={() => { guide.navigate('compare'); }} onDismiss={() => { guide.dismiss(); }} /></>;
  }
  const h = await mountDom(<Fixture />);
  return { ...h, storage, navigations, checked, focused, effects, guide: () => guide, publish, failures: () => failures };
}
const run: Runtime = { ...initial, participating: ['claude', 'kimi'], runId: 'run-a', activeSites: ['claude', 'kimi'], progress: copies() };

test('an initial invitation causes no focus, selection, health or send action until a user opens it', async () => {
  const h = await fixture();
  try {
    assert.equal(h.document.querySelector('[data-workbench-guide="invite"]') === null, false);
    assert.deepEqual(h.effects, []); assert.deepEqual(h.checked, []); assert.deepEqual(h.navigations, []);
    assert.deepEqual(h.storage.writes, []);
    const outside = h.document.getElementById('external-focus')!; outside.focus();
    await act(async () => h.publish({ ...initial, participating: ['claude', 'kimi'] }));
    assert.equal(h.document.activeElement === outside, true, 'guide progress must not move focus');
    await h.click(h.document.querySelector('[data-guide-action="open"]')!);
    assert.deepEqual(h.effects, ['open-guide']);
  } finally { await h.close(); }
});

test('dismissal persists locally across reload while persistence failure hides only this session and reports once', async () => {
  const h = await fixture();
  try {
    await act(async () => { assert.equal(h.guide().dismiss(), true); });
    assert.equal(h.guide().model.stage, 'hidden');
    assert.deepEqual(readLocalUiPreferences(h.storage).workbenchGuide, { version: 1, disposition: 'dismissed' });
  } finally { await h.close(); }
  const reloaded = await fixture(initial, h.storage);
  try { assert.equal(reloaded.guide().model.stage, 'hidden'); } finally { await reloaded.close(); }
  const failed = await fixture();
  try {
    failed.storage.fail();
    await act(async () => { assert.equal(failed.guide().dismiss(), false); failed.guide().dismiss(); });
    assert.equal(failed.guide().model.stage, 'hidden');
    assert.equal(failed.failures(), 1);
    assert.deepEqual(failed.storage.writes, []);
  } finally { await failed.close(); }
});

test('two-site recovery checks exactly current participants and a login action only opens its named site', async () => {
  const h = await fixture({ ...initial, participating: ['claude', 'kimi'] });
  try {
    assert.equal(h.document.querySelector('[data-guide-action="check"]') === null, false);
    assert.equal(h.document.querySelector('[data-guide-site="kimi"]')!.textContent!.includes(getCopy('en').healthAdviceSignIn), true);
    await h.click(h.document.querySelector('[data-guide-action="check"]')!);
    assert.deepEqual(h.checked, [['claude', 'kimi']]);
    await h.click(h.document.querySelector('[data-guide-focus-site="kimi"]')!);
    assert.deepEqual(h.focused, ['kimi']);
    assert.deepEqual(h.effects, []); assert.deepEqual(h.navigations, []); assert.deepEqual(h.storage.writes, []);
  } finally { await h.close(); }
});

test('reading partial copies sends an exact saved-answer request and only a matching ready ACK completes the guide', async () => {
  const h = await fixture(run);
  try {
    const button = h.document.querySelector<HTMLButtonElement>('[data-guide-action="read"]');
    assert.equal(button === null, false);
    await h.click(button!);
    assert.equal(h.navigations.length, 1);
    const request = h.navigations[0];
    assert.equal(request.questionId, 'question-a'); assert.equal(request.runId, 'run-a');
    assert.equal(request.mode, 'read'); assert.deepEqual(request.answerIds, ['claude-1']);
    assert.deepEqual(h.storage.writes, [], 'clicking a read button must not complete onboarding');
    await act(async () => { assert.equal(h.guide().acknowledgeRead('other-question', request.request), false); });
    assert.deepEqual(h.storage.writes, []);
    await act(async () => { assert.equal(h.guide().acknowledgeRead('question-a', request.request), true); });
    assert.deepEqual(readLocalUiPreferences(h.storage).workbenchGuide, { version: 1, disposition: 'completed' });
    assert.equal(h.guide().model.stage, 'hidden');
  } finally { await h.close(); }
});

test('comparison completes only after an explicit saved-copy archive is entered, not after reader-ready', async () => {
  const h = await fixture({ ...run, progress: copies(true) });
  try {
    let request: GuideNavigationRequest | null = null;
    await act(async () => { request = h.guide().navigate('compare'); });
    assert.equal(request === null, false, 'two complete copies need an explicit comparison intent');
    const pending = h.guide().pendingNavigation!;
    assert.deepEqual(pending.answerIds, ['claude-1', 'kimi-1']);
    await act(async () => { assert.equal(h.guide().acknowledgeRead('question-a', pending.request), false);
      assert.equal(h.guide().acknowledgeCompare('question-a', pending.request, ''), false); });
    assert.deepEqual(h.storage.writes, []);
    await act(async () => { assert.equal(h.guide().acknowledgeCompare('question-a', pending.request, 'archive-a'), true); });
    assert.deepEqual(readLocalUiPreferences(h.storage).workbenchGuide, { version: 1, disposition: 'completed' });
  } finally { await h.close(); }
});

test('new runs and successful reset invalidate old ready ACKs instead of writing a late completion', async () => {
  const h = await fixture(run);
  try {
    await act(async () => { h.guide().navigate('read'); });
    assert.equal(h.navigations.length, 1);
    const old = h.navigations[0];
    await act(async () => h.publish({ ...run, runId: 'new-run', progress: null }));
    await act(async () => { assert.equal(h.guide().acknowledgeRead('question-a', old.request), false); });
    assert.deepEqual(h.storage.writes, []);
    await act(async () => h.publish(run));
    await act(async () => { h.guide().navigate('read'); });
    const reset = h.navigations.at(-1)!;
    await act(async () => h.guide().invalidate());
    await act(async () => { assert.equal(h.guide().acknowledgeRead('question-a', reset.request), false); });
    assert.deepEqual(h.storage.writes, []);
  } finally { await h.close(); }
});

test('an A-to-B-to-A latest-attempt projection cannot revive its old pending read request', async () => {
  const h = await fixture(run);
  try {
    await act(async () => { h.guide().navigate('read'); });
    const old = h.navigations[0];
    const newer = copies();
    await act(async () => h.publish({ ...run, progress: { ...newer, revision: 2,
      answers: newer.answers.map(answer => answer.site === 'claude' ? { ...answer, id: 'claude-2', attempt: 2 } : answer) } }));
    await act(async () => h.publish(run));
    await act(async () => { assert.equal(h.guide().acknowledgeRead('question-a', old.request), false); });
    assert.deepEqual(h.storage.writes, []);
    await act(async () => { h.guide().navigate('read'); });
    const next = h.navigations.at(-1)!;
    assert.equal(next.request > old.request, true);
    assert.equal(next.answerIds.every(id => id.length > 0), true);
    await act(async () => { assert.equal(h.guide().acknowledgeRead('question-a', next.request), true); });
  } finally { await h.close(); }
});

test('failed or canceled saved navigation releases its request without completing or canceling a newer request', async () => {
  const h = await fixture(run);
  try {
    await act(async () => { h.guide().navigate('read'); });
    const old = h.navigations[0];
    await act(async () => { assert.equal(h.guide().cancelNavigation(old.request), true); });
    assert.equal(h.guide().pendingNavigation, null);
    await act(async () => { assert.equal(h.guide().acknowledgeRead('question-a', old.request), false); h.guide().navigate('read'); });
    const next = h.navigations.at(-1)!;
    await act(async () => { assert.equal(h.guide().cancelNavigation(old.request), false); });
    assert.equal(h.guide().pendingNavigation?.request, next.request);
    assert.deepEqual(h.storage.writes, []);
    await act(async () => { assert.equal(h.guide().acknowledgeRead('question-a', next.request), true); });
  } finally { await h.close(); }
});

test('the same latest attempt becoming complete during reading does not discard a correct saved-reader ACK', async () => {
  const h = await fixture(run);
  try {
    await act(async () => { h.guide().navigate('read'); });
    const request = h.navigations[0];
    await act(async () => h.publish({ ...run, progress: { ...copies(true), revision: 2 } }));
    await act(async () => { assert.equal(h.guide().acknowledgeRead('question-a', request.request), true,
      'completeness promotion keeps the same question and latest answer identities'); });
    assert.deepEqual(readLocalUiPreferences(h.storage).workbenchGuide, { version: 1, disposition: 'completed' });
  } finally { await h.close(); }
});
