import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { SITES } from '../../src/main/sites';
import { getCopy } from '../../src/shared/copy';
import type { BroadcastRequest } from '../../src/shared/protocol';
import { ExclusiveActionLock } from '../../src/renderer/broadcast-flow-state';
import { useBroadcastFlow } from '../../src/renderer/use-broadcast-flow';
import { useBroadcastRetryReview } from '../../src/renderer/use-broadcast-retry-review';
import { setShellApi } from '../../src/renderer/shell-api';
import '../../src/renderer/styles.css';

const query = new URLSearchParams(location.search), copy = getCopy(query.get('locale') ?? 'en');
const calls: BroadcastRequest[] = [], lock = new ExclusiveActionLock();
setShellApi({ broadcast: async (request: BroadcastRequest) => {
  calls.push(request);
  return request.sites.map(site => ({ site, ok: false, code: site === 'claude' ? 'composer_not_found'
    : site === 'chatgpt' ? 'cancelled' : site === 'gemini' ? 'timeout' : 'submit_unconfirmed' }));
} } as any);
const frozen = { text: 'Frozen original question 😀', tier: 'think' as const,
  sites: ['claude', 'chatgpt', 'kimi', 'gemini'] as const, images: [] };
function App() {
  const [inspected, setInspected] = useState(''), [surface, setSurface] = useState('sites');
  const flow = useBroadcastFlow(() => undefined, () => undefined, () => undefined, () => undefined);
  const retry = useBroadcastRetryReview({ copy, sites: SITES, flow, lock, busy: flow.runState !== 'idle',
    onOpen: () => setSurface('confirmation'), onClose: () => setSurface('sites'), onInspect: setInspected });
  useEffect(() => { void flow.send(frozen); }, []);
  (window as any).retryEvidence = () => flow.acceptStatus({ site: 'kimi', phase: 'submitted',
    submission: { runId: calls[0].runId, state: 'sent', submissionEvidence: 'message' } });
  (window as any).retryInvalidate = flow.invalidate;
  (window as any).retryState = () => ({ calls, inspected, surface, ready: flow.runState === 'idle' && !!flow.runId });
  return <main style={{ padding: 20 }}>
    <button style={{ minHeight: 32 }} id="review" disabled={flow.runState !== 'idle'} onClick={retry.reviewUncertain}>{copy.retryReviewAction.replace('{count}', '3')}</button>
    <button style={{ minHeight: 32 }} id="ordinary" onClick={() => retry.request()}>{copy.retryFailedSites.replace('{count}', '1')}</button>
    <output>{inspected}</output>{retry.review}
  </main>;
}
document.documentElement.lang = query.get('locale') ?? 'en';
createRoot(document.getElementById('root')!).render(<App />);
