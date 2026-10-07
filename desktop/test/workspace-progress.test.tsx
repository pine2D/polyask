import assert from 'node:assert/strict';
import test from 'node:test';
import { useState } from 'react';
import { WorkspaceProgress } from '../src/renderer/workspace-progress';
import { getCopy } from '../src/shared/copy';
import { SITE_KEYS } from '../src/shared/contracts';
import { metricsForDensity, shellHeightForComposer } from '../src/shared/display';
import { SITES } from '../src/main/sites';
import { mountDom } from './ui/dom-harness';

test('opened page groups expose short site names including a single page and full names in their label', async () => {
  const h = await mountDom(<WorkspaceProgress copy={getCopy('en')} sites={SITES} selectedSites={['claude', 'kimi']}
    statuses={{}} page={0} inputMethod="pointer" runId={null} activeSites={[]} progress={null} onPageChange={() => undefined} onRead={() => undefined}/>);
  try {
    const tab = h.document.querySelector<HTMLButtonElement>('[role="tab"]');
    assert.equal(!!tab, true); assert.match(tab!.textContent!, /Claude.*Kimi/);
    assert.match(tab!.getAttribute('aria-label')!, /Claude.*Kimi/);
  } finally { await h.close(); }
});
test('visible facts remain separate and reading a saved partial copy performs only the reading callback', async () => {
  let reads = 0;
  const h = await mountDom(<WorkspaceProgress copy={getCopy('en')} sites={SITES} selectedSites={['claude']}
    statuses={{ claude: { site: 'claude', phase: 'complete', submission: { runId: 'a', state: 'sent' }, generation: { runId: 'a', state: 'complete' } } }}
    page={0} inputMethod="pointer" runId="a" activeSites={['claude']} progress={{ runId: 'a', questionId: 'q', revision: 1, state: 'available', answers: [
      { id: 'answer', site: 'claude', attempt: 1, submission: 'submitted', capture: 'partial', hasText: true, truncated: false, sealedAt: null }
    ] }} onPageChange={() => undefined} onRead={() => { reads++; }}/>);
  try {
    assert.equal(h.document.querySelector('[data-progress="submitted"]')?.textContent?.includes('1/1'), true);
    assert.equal(h.document.querySelector('[data-progress="ended"]')?.textContent?.includes('1/1'), true);
    assert.equal(h.document.querySelector('[data-progress="complete"]')?.textContent?.includes('0/1'), true);
    assert.equal(h.document.querySelector('[data-progress="partial"]')?.textContent?.includes('1'), true);
    const button = h.document.querySelector<HTMLButtonElement>('[name="read-run-copies"]');
    assert.equal(!!button, true); assert.equal(button!.disabled, false); await h.click(button!); assert.equal(reads, 1);
  } finally { await h.close(); }
});
test('page movement retains manual activation and filters old run exception badges', async () => {
  function Fixture() { const [page, setPage] = useState(0); return <WorkspaceProgress copy={getCopy('en')} sites={SITES}
    selectedSites={SITE_KEYS} statuses={{ claude: { site: 'claude', phase: 'failed', submission: { runId: 'old', state: 'failed' } } }}
    page={page} inputMethod="keyboard" runId="a" activeSites={['claude']} progress={null} onPageChange={setPage} onRead={() => undefined}/>; }
  const h = await mountDom(<Fixture/>);
  try {
    const tabs = [...h.document.querySelectorAll<HTMLButtonElement>('[role="tab"]')]; assert.equal(tabs.length, 3);
    tabs[0].focus(); tabs[0].dispatchEvent(new h.window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    assert.equal(h.document.activeElement === tabs[1], true); assert.equal(tabs[0].getAttribute('aria-selected'), 'true');
    assert.equal(h.document.querySelectorAll('.page-tab-badge.failed').length, 0);
  } finally { await h.close(); }
});
test('native workspace chrome reserves the progress strip exactly once in either density and composer state', () => {
  for (const density of ['compact', 'comfortable'] as const) {
    assert.equal(shellHeightForComposer(density, false), metricsForDensity(density).shellHeight + 32);
    assert.equal(shellHeightForComposer(density, true), (density === 'compact' ? 120 : 144) + 32);
  }
});
