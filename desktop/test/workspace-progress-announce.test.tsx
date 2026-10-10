import assert from 'node:assert/strict';
import test from 'node:test';
import { act } from 'react';
import { FeedbackProvider } from '../src/renderer/feedback-provider';
import { WorkspaceProgress } from '../src/renderer/workspace-progress';
import { getCopy } from '../src/shared/copy';
import { mountDom } from './ui/dom-harness';

const copy = getCopy('en');
// The persistent live region clears first and writes on the next frame (R33).
const nextFrame = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 40)); });
const view = (phase: 'submitted' | 'generating') => <FeedbackProvider copy={copy}><WorkspaceProgress copy={copy}
  statuses={{ claude: { site: 'claude', phase, submission: { runId: 'a', state: 'sent' }, generation: { runId: 'a', state: phase === 'generating' ? 'generating' : 'idle' } } as any }}
  runId="a" activeSites={['claude']} progress={null} onRead={() => {}} /></FeedbackProvider>;

test('progress summary is not a second live region; the stage is announced once through the global channel', async () => {
  const h = await mountDom(view('submitted'));
  try {
    const summary = h.document.querySelector('.run-progress-summary')!;
    assert.equal(summary.getAttribute('aria-live'), null);
    assert.equal(summary.getAttribute('role'), null);
    const live = () => [...h.document.querySelectorAll('[aria-live]')].map(node => node.textContent);
    assert.equal(live().length, 1);
    await nextFrame();
    assert.equal(live()[0]?.includes(copy.runStageWaiting), true);
    await h.render(view('generating'));
    await nextFrame();
    assert.equal(live()[0]?.includes(copy.runStageGenerating), true);
  } finally { await h.close(); }
});
