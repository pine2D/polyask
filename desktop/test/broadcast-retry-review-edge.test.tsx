import assert from 'node:assert/strict';
import test from 'node:test';
import { act } from 'react';
import { SITES } from '../src/main/sites';
import { getCopy } from '../src/shared/copy';
import type { BroadcastRequest, SiteRunResult, SiteStatus } from '../src/shared/protocol';
import { ExclusiveActionLock } from '../src/renderer/broadcast-flow-state';
import { setShellApi } from '../src/renderer/shell-api';
import { useBroadcastFlow } from '../src/renderer/use-broadcast-flow';
import { useBroadcastRetryReview } from '../src/renderer/use-broadcast-retry-review';
import { mountDom } from './ui/dom-harness';

for (const result of [undefined, {site:'kimi',ok:false,code:'timeout'},
  {site:'kimi',ok:false,code:'future_failure'}, {site:'kimi',ok:false}] as const) {
  test(`late sent evidence removes a ${result?.code ?? (result ? 'code-less' : 'missing')} outcome from review`, async () => {
    const calls: BroadcastRequest[] = [];
    let flow!: ReturnType<typeof useBroadcastFlow>;
    const lock = new ExclusiveActionLock();
    setShellApi({ broadcast: async (request: BroadcastRequest) => {
      calls.push(request); return result ? [result as SiteRunResult] : [];
    } } as any);
    function Fixture() {
      flow = useBroadcastFlow(() => undefined, () => undefined, () => undefined, () => undefined);
      const retry = useBroadcastRetryReview({copy:getCopy('en'), sites:SITES, flow, lock,
        busy:flow.runState !== 'idle', onOpen:() => undefined, onClose:() => undefined,
        onInspect:() => undefined});
      return <><button id="review" onClick={retry.reviewUncertain}>Review</button>{retry.review}</>;
    }
    const h = await mountDom(<Fixture />);
    try {
      await act(async () => { await flow.send({text:'Frozen original',tier:null,sites:['kimi'],images:[]}); });
      await h.click(h.document.getElementById('review')!);
      await h.click(h.document.querySelector('[name="retry-site"]')!);
      await act(async () => flow.acceptStatus({site:'kimi',phase:'submitted',
        submission:{runId:calls[0].runId,state:'sent'}} as SiteStatus));
      assert.equal((h.document.querySelector('[name="retry-site"]')) === (null), true,
        'positive same-run sent evidence must invalidate the old resend choice');
      assert.equal(h.document.querySelector<HTMLButtonElement>('.retry-review-confirm')!.disabled, true);
      assert.equal(calls.length, 1);
    } finally { await h.close(); }
  });
}
