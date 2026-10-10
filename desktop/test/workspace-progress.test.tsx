import assert from 'node:assert/strict';
import test from 'node:test';
import { useState } from 'react';
import { FeedbackProvider } from '../src/renderer/feedback-provider';
import { PageTabs } from '../src/renderer/page-tabs';
import { WorkspaceProgress } from '../src/renderer/workspace-progress';
import { getCopy } from '../src/shared/copy';
import { SITE_KEYS } from '../src/shared/contracts';
import { metricsForDensity, shellHeightForComposer } from '../src/shared/display';
import { SITES } from '../src/main/sites';
import { mountDom } from './ui/dom-harness';

test('progress prioritizes uncertain submissions and expands separate counters without an overlay', async () => {
  const h = await mountDom(<FeedbackProvider copy={getCopy('en')}><WorkspaceProgress copy={getCopy('en')}
    statuses={{ kimi: { site: 'kimi', phase: 'failed', submission: { runId: 'a', state: 'unconfirmed' } },
      claude: { site: 'claude', phase: 'submitted', submission: { runId: 'a', state: 'sent' } } }}
    runId="a" activeSites={['claude', 'kimi']} progress={null} onRead={() => {}} /></FeedbackProvider>);
  try {
    assert.match(h.document.querySelector('.run-progress-summary')?.textContent ?? '', /Unconfirmed 1/);
    assert.match(h.document.querySelector('[data-progress-stage]')?.textContent ?? '', /Waiting for answers/);
    const toggle = h.document.querySelector<HTMLButtonElement>('[name="run-progress-details"]');
    assert.equal(toggle === null, false, 'full counters must be available through a real control');
    assert.equal(toggle!.getAttribute('aria-expanded'), 'false');
    await h.click(toggle!);
    const facts = h.document.querySelector<HTMLElement>('.run-progress-facts')!;
    assert.equal(toggle!.getAttribute('aria-expanded'), 'true');
    assert.equal(facts.getAttribute('aria-hidden'), 'false');
    assert.equal(facts.tabIndex, 0);
    assert.equal(h.document.querySelector('[data-progress="complete"]')!.textContent!.includes('0/2'), true);
    assert.equal(h.document.querySelector('[role="dialog"]') === null, true);
    assert.equal(h.document.querySelector<HTMLButtonElement>('[name="read-run-copies"]')!.disabled, true);
  } finally { await h.close(); }
});

test('a single opened page has no pagination controls', async () => {
  const h = await mountDom(<PageTabs copy={getCopy('en')} sites={SITES} selectedSites={['claude', 'kimi']}
    statuses={{}} page={0} inputMethod="pointer" onPageChange={() => undefined}/>);
  try { assert.equal(h.document.querySelectorAll('[role="tab"]').length, 0); }
  finally { await h.close(); }
});
test('visible facts remain separate and reading a saved partial copy performs only the reading callback', async () => {
  let reads = 0;
  const h = await mountDom(<FeedbackProvider copy={getCopy('en')}><WorkspaceProgress copy={getCopy('en')}
    statuses={{ claude: { site: 'claude', phase: 'complete', submission: { runId: 'a', state: 'sent' }, generation: { runId: 'a', state: 'complete' } } }}
    runId="a" activeSites={['claude']} progress={{ runId: 'a', questionId: 'q', revision: 1, state: 'available', answers: [
      { id: 'answer', site: 'claude', attempt: 1, submission: 'submitted', capture: 'partial', hasText: true, truncated: false, sealedAt: null }
    ] }} onRead={() => { reads++; }}/></FeedbackProvider>);
  try {
    assert.equal(!!h.document.querySelector('.feedback-bar .run-progress'), true);
    assert.equal(h.document.querySelector('[data-progress="submitted"]')?.textContent?.includes('1/1'), true);
    assert.equal(h.document.querySelector('[data-progress="ended"]')?.textContent?.includes('1/1'), true);
    assert.equal(h.document.querySelector('[data-progress="complete"]')?.textContent?.includes('0/1'), true);
    assert.equal(h.document.querySelector('[data-progress="partial"]')?.textContent?.includes('1'), true);
    assert.equal(h.document.querySelector('[data-progress-stage]')!.textContent, getCopy('en').runStageEnded);
    const button = h.document.querySelector<HTMLButtonElement>('[name="read-run-copies"]');
    assert.equal(!!button, true); assert.equal(button!.disabled, false); await h.click(button!); assert.equal(reads, 1);
  } finally { await h.close(); }
});

test('partial or unavailable copies never claim that copies are complete or being saved', async () => {
  const copy = getCopy('en');
  const props = { copy, statuses: { claude: { site: 'claude' as const, phase: 'complete' as const,
    submission: { runId: 'a', state: 'sent' as const }, generation: { runId: 'a', state: 'complete' as const } } },
    runId: 'a', activeSites: ['claude'] as const, onRead: () => {} };
  const h = await mountDom(<FeedbackProvider copy={copy}><WorkspaceProgress {...props}
    progress={{ runId: 'a', questionId: 'q', revision: 1, state: 'unavailable', answers: [] }} /></FeedbackProvider>);
  try {
    assert.equal(h.document.querySelector('[data-progress-stage]')!.textContent, copy.runStageEnded);
    assert.equal(h.document.querySelector('[data-progress-alert="unavailable"]')!.textContent, copy.runCopiesUnavailable);
    await h.render(<FeedbackProvider copy={copy}><WorkspaceProgress {...props}
      progress={{ runId: 'a', questionId: 'q', revision: 2, state: 'available', answers: [
        { id: 'answer', site: 'claude', attempt: 1, submission: 'submitted', capture: 'complete', hasText: true, truncated: true, sealedAt: 1 }
      ] }} /></FeedbackProvider>);
    assert.equal(h.document.querySelector('[data-progress-stage]')!.textContent, copy.runStageEnded);
    assert.equal(h.document.querySelector('[data-progress="complete"]')!.textContent!.includes('0/1'), true);
    assert.equal(h.document.querySelector('[data-progress="partial"]')!.textContent!.includes('1'), true);
  } finally { await h.close(); }
});
test('page movement retains manual activation and filters old run exception badges', async () => {
  function Fixture() { const [page, setPage] = useState(0); return <PageTabs copy={getCopy('en')} sites={SITES}
    selectedSites={SITE_KEYS} statuses={{ claude: { site: 'claude', phase: 'failed', submission: { runId: 'old', state: 'failed' } } }}
    page={page} inputMethod="keyboard" summaryRunId="a" onPageChange={setPage}/>; }
  const h = await mountDom(<Fixture/>);
  try {
    const tabs = [...h.document.querySelectorAll<HTMLButtonElement>('[role="tab"]')]; assert.equal(tabs.length, 3);
    tabs[0].focus(); tabs[0].dispatchEvent(new h.window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    assert.equal(h.document.activeElement === tabs[1], true); assert.equal(tabs[0].getAttribute('aria-selected'), 'true');
    assert.equal(h.document.querySelectorAll('.page-tab-badge.failed').length, 0);
  } finally { await h.close(); }
});
test('native workspace chrome reserves only the composer; progress uses the existing footer', () => {
  for (const density of ['compact', 'comfortable'] as const) {
    assert.equal(shellHeightForComposer(density, false), metricsForDensity(density).shellHeight);
    assert.equal(shellHeightForComposer(density, true), (density === 'compact' ? 120 : 144));
  }
});
