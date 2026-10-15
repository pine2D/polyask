import assert from 'node:assert/strict';
import test from 'node:test';
import { FeedbackProvider, useGlobalFeedback } from '../src/renderer/feedback-provider';
import { WorkspaceActions } from '../src/renderer/workspace-actions';
import { broadcastFeedback } from '../src/renderer/broadcast-feedback';
import { completeRun } from '../src/renderer/broadcast-run';
import { getCopy } from '../src/shared/copy';
import { mountDom } from './ui/dom-harness';

const copy = getCopy('en'), noop = () => {};
const submitted = broadcastFeedback(copy, completeRun({ runId: 'run', text: 'Question', sites: ['claude', 'kimi'], tier: null, images: [] },
  [{ site: 'claude', ok: true }, { site: 'kimi', ok: true }]));
function Notices() {
  const feedback = useGlobalFeedback();
  return <>
    <button onClick={() => feedback.announce(submitted)}>Submitted</button>
    <button onClick={() => { feedback.announce('Save failed.'); feedback.setNoticeAction({ label: 'Recover', run: noop }); }}>Fail</button>
    <button onClick={() => feedback.setUndoAction({ label: 'Undo', run: () => feedback.setUndoAction(null) })}>Delete</button>
  </>;
}
function Fixture({ ready = true, busy = false, onCompare = noop }: { ready?: boolean; busy?: boolean; onCompare?: () => void }) {
  return <FeedbackProvider copy={copy}><Notices /><WorkspaceActions copy={copy} disabled={busy}
    failureCount={0} cancelledCount={0} synthesisPending={false}
    syncStatus={{ state: 'idle', connected: false, pending: 0, errorCount: 0, readOnly: false, oauthConfigured: false, secureTokenStorage: true }}
    onCompare={ready ? onCompare : undefined} onRetry={noop} onOpenArchive={noop} onOpenMore={noop} /></FeedbackProvider>;
}

test('ready answers offer a named next step that only runs on click and clears while unavailable', async () => {
  let oldCalls = 0, calls = 0;
  const h = await mountDom(<Fixture onCompare={() => oldCalls++} />);
  try {
    const next = () => h.document.querySelector<HTMLButtonElement>('.feedback-next-step');
    assert.equal(next()?.textContent, 'Capture and compare');
    assert.equal(oldCalls, 0, 'availability never collects automatically');
    await h.render(<Fixture onCompare={() => calls++} />);
    await h.click(next()!); assert.equal(calls, 1); assert.equal(oldCalls, 0, 'the action uses the latest scope callback');
    await h.render(<Fixture busy onCompare={() => calls++} />);
    assert.equal(next() === null, true);
    await h.render(<Fixture ready={false} onCompare={() => calls++} />);
    assert.equal(next() === null, true);
    assert.equal(calls, 1);
  } finally { await h.close(); }
});

test('the persistent broadcast summary stays visible while ready answers offer their next step', async () => {
  const h = await mountDom(<Fixture ready={false} />);
  try {
    await h.click([...h.document.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent === 'Submitted')!);
    await h.render(<Fixture />);
    assert.equal(h.document.querySelector('.feedback-notice')!.textContent, submitted);
    assert.equal(h.document.querySelector('.feedback-next-step')?.textContent, 'Capture and compare');
  } finally { await h.close(); }
});

test('collection guidance yields to error recovery and undo, then returns after dismissal', async () => {
  const h = await mountDom(<Fixture />);
  try {
    const button = (label: string) => [...h.document.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent === label)!;
    await h.click(button('Fail'));
    assert.equal(h.document.querySelector('.feedback-next-step') === null, true);
    assert.equal(!!button('Recover'), true);
    assert.equal(h.document.querySelector('.feedback-notice')!.textContent, 'Save failed.');
    await h.click(button(copy.dismissFeedback));
    assert.equal(h.document.querySelector('.feedback-next-step')?.textContent, 'Capture and compare');
    await h.click(button('Delete'));
    assert.equal(h.document.querySelector('.feedback-next-step') === null, true);
    await h.click(button('Undo'));
    assert.equal(h.document.querySelector('.feedback-next-step')?.textContent, 'Capture and compare');
  } finally { await h.close(); }
});
