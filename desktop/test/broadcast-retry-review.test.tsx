import assert from 'node:assert/strict';
import test from 'node:test';
import { act, useState } from 'react';
import { SITES } from '../src/main/sites';
import { getCopy } from '../src/shared/copy';
import type { BroadcastRequest, SiteRunResult, SiteStatus } from '../src/shared/protocol';
import { setShellApi } from '../src/renderer/shell-api';
import { ExclusiveActionLock } from '../src/renderer/broadcast-flow-state';
import { useBroadcastFlow } from '../src/renderer/use-broadcast-flow';
import { useBroadcastRetryReview } from '../src/renderer/use-broadcast-retry-review';
import { mountDom } from './ui/dom-harness';

const copy = getCopy('en');
const payload = { text: 'Frozen question 😀\nOriginal whitespace  kept', tier: 'think' as const,
  sites: ['claude', 'chatgpt', 'kimi', 'gemini', 'deepseek'] as const, images: [] };
const results: SiteRunResult[] = [
  {site:'claude',ok:false,code:'composer_not_found'}, {site:'chatgpt',ok:false,code:'cancelled'},
  {site:'kimi',ok:false,code:'submit_unconfirmed'}, {site:'gemini',ok:false,code:'timeout'},
  {site:'deepseek',ok:false,code:'future_failure'}
];
async function fixture(onInspect?: (site: string, active: () => boolean) => Promise<void>) {
  const calls: BroadcastRequest[] = [], inspections: string[] = [];
  let flow!: ReturnType<typeof useBroadcastFlow>, controller!: ReturnType<typeof useBroadcastRetryReview>;
  let busy!: (value: boolean) => void;
  const lock = new ExclusiveActionLock();
  setShellApi({ broadcast: async (request: BroadcastRequest) => { calls.push(request); return results.filter(r => request.sites.includes(r.site)); },
    cancel: () => undefined } as any);
  function Fixture() {
    const [blocked, setBlocked] = useState(false); busy = setBlocked;
    flow = useBroadcastFlow(() => undefined, () => undefined, () => undefined, () => undefined);
    controller = useBroadcastRetryReview({ copy, sites: SITES, flow, lock, busy: blocked,
      onOpen: () => undefined, onClose: () => undefined, onInspect: (site, active) => { inspections.push(site); return onInspect?.(site, active); } });
    return <><button id="retry" onClick={() => controller.request()}>Retry failures</button>
      <button id="review" onClick={controller.reviewUncertain}>Review uncertain</button>{controller.review}</>;
  }
  const h = await mountDom(<Fixture />);
  await act(async () => { await flow.send(payload); });
  return { ...h, calls, inspections, flow: () => flow, controller: () => controller, busy, lock,
    review: () => h.click(h.document.getElementById('review')!),
    confirm: () => h.document.querySelector<HTMLButtonElement>('.retry-review-confirm')!,
    choice: (site: string) => h.document.querySelector<HTMLInputElement>(`input[name="retry-site"][value="${site}"]`)!,
    inspect: (site: string) => h.document.querySelector<HTMLButtonElement>(`button[data-inspect-site="${site}"]`)! };
}

test('default retry excludes uncertain sites and preserves the original payload', async () => {
  const h = await fixture();
  try {
    await h.click(h.document.getElementById('retry')!);
    assert.deepEqual(h.calls[1], { ...h.calls[0], sites: ['claude'] });
    assert.equal((h.document.querySelector('[role="dialog"]')) === (null), true);
  } finally { await h.close(); }
});

test('review starts unchecked, inspection sends nothing and confirmed choices keep frozen content', async () => {
  const h = await fixture();
  try {
    await h.review();
    assert.ok(h.document.querySelector('[role="dialog"]'), 'uncertain outcomes open a review');
    assert.equal(h.calls.length, 1);
    assert.equal(h.confirm().disabled, true);
    assert.ok([...h.document.querySelectorAll<HTMLInputElement>('[name="retry-site"]')].every(node => !node.checked));
    await h.click(h.inspect('kimi'));
    assert.deepEqual(h.inspections, ['kimi']); assert.equal(h.calls.length, 1);
    await h.review(); await h.click(h.choice('gemini')); await h.click(h.confirm());
    assert.deepEqual(h.calls[1], { ...h.calls[0], sites:['gemini'] });
  } finally { await h.close(); }
});

test('late submission confirmation removes an old resend choice while review is open', async () => {
  const h = await fixture();
  try {
    await h.review(); await h.click(h.choice('kimi'));
    await act(async () => h.flow().acceptStatus({site:'kimi',phase:'submitted',submission:{runId:h.calls[0].runId,state:'sent'}} as SiteStatus));
    assert.equal((h.choice('kimi')) === (null), true);
    assert.equal(h.confirm().disabled, true);
    assert.equal(h.calls.length, 1);
  } finally { await h.close(); }
});

test('reset and a new run invalidate the old review rather than using its choices', async () => {
  const h = await fixture();
  try {
    await h.review(); await h.click(h.choice('kimi'));
    await act(async () => h.flow().invalidate());
    assert.equal((h.document.querySelector('[role="dialog"]')) === (null), true);
    await act(async () => { await h.flow().send({...payload,text:'New question'}); });
    await h.review(); assert.equal(h.choice('kimi').checked, false);
    await act(async () => { await h.flow().send({...payload,text:'Third question'}); });
    assert.equal((h.document.querySelector('[role="dialog"]')) === (null), true);
    assert.equal(h.calls.length, 3);
  } finally { await h.close(); }
});

test('busy work and the physical action lock prevent confirmed retries', async () => {
  const h = await fixture();
  try {
    await h.review(); await h.click(h.choice('kimi'));
    await act(async () => h.busy(true)); assert.equal(h.confirm().disabled, true);
    await h.click(h.confirm()); assert.equal(h.calls.length, 1);
    await act(async () => h.busy(false));
    let release!: () => void;
    const active = h.lock.run(() => new Promise<void>(resolve => { release = resolve; }));
    await h.click(h.confirm()); assert.equal(h.calls.length, 1);
    release(); await active;
  } finally { await h.close(); }
});

test('an inspection keeps review blocked until its acknowledgement arrives', async () => {
  let release: () => void = () => {};
  const response = new Promise<void>(resolve => { release = resolve; });
  const h = await fixture(async () => { await response; });
  try {
    await h.review(); await h.click(h.inspect('kimi'));
    assert.equal(h.controller().open, true);
    assert.equal(h.confirm().disabled, true);
    assert.equal(h.choice('kimi').disabled, true);
    await h.click(h.confirm()); assert.equal(h.calls.length, 1);
    await act(async () => { release(); await response; });
    assert.equal(h.controller().open, false);
    assert.equal(h.calls.length, 1);
  } finally { await act(async () => { release(); await response; }); await h.close(); }
});

test('invalidating a pending inspection prevents its reply from applying navigation', async () => {
  let release: () => void = () => {}, applied = 0;
  const response = new Promise<void>(resolve => { release = resolve; });
  const h = await fixture(async (_site, active) => { await response; if (active?.()) applied++; });
  try {
    await h.review(); await h.click(h.inspect('kimi'));
    assert.equal(h.controller().open, true);
    await act(async () => h.flow().invalidate());
    await act(async () => { release(); await response; });
    assert.equal(applied, 0);
    assert.equal(h.controller().open, false);
    assert.equal(h.calls.length, 1);
  } finally { await act(async () => { release(); await response; }); await h.close(); }
});
