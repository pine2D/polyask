import assert from 'node:assert/strict';
import test from 'node:test';
import { act } from 'react';
import { useBroadcastFlow } from '../src/renderer/use-broadcast-flow';
import { setShellApi } from '../src/renderer/shell-api';
import type { BroadcastRequest, SiteRunResult } from '../src/shared/protocol';
import type { SiteKey } from '../src/shared/contracts';
import { mountDom } from './ui/dom-harness';

const noop = () => undefined;
async function probe() {
  let flow!: ReturnType<typeof useBroadcastFlow>;
  function Probe() { flow = useBroadcastFlow(noop, noop, noop, noop); return <output>{flow.runId}</output>; }
  const h = await mountDom(<Probe />);
  return { ...h, current: () => flow };
}
test('a dispatched run exposes its frozen identity and full scope before the submission reply', async () => {
  let request!: BroadcastRequest, finish!: (value: SiteRunResult[]) => void;
  setShellApi({ broadcast: (value: BroadcastRequest) => { request = value; return new Promise(resolve => { finish = resolve; }); }, cancel: noop } as any);
  const h = await probe();
  try {
    const sites: SiteKey[] = ['claude', 'kimi']; let sending!: Promise<unknown>;
    await act(async () => { sending = h.current().send({ text: 'Question', tier: null, sites, images: [] }); });
    sites.push('gemini');
    assert.equal(h.current().runId, request.runId);
    assert.deepEqual((h.current() as any).activeSites, ['claude', 'kimi']);
    await act(async () => h.current().cancel());
    assert.equal(h.current().runId, request.runId, 'cancelled dispatch still has an uncertain current identity');
    await act(async () => { finish([]); await sending; });
  } finally { await h.close(); setShellApi(null); }
});
test('explicit invalidation drops run identity and a late reply cannot restore it', async () => {
  let finish!: (value: SiteRunResult[]) => void;
  setShellApi({ broadcast: () => new Promise(resolve => { finish = resolve; }) } as any);
  const h = await probe();
  try {
    let sending!: Promise<unknown>;
    await act(async () => { sending = h.current().send({ text: 'Question', tier: null, sites: ['kimi'], images: [] }); });
    await act(async () => h.current().invalidate());
    assert.equal(h.current().runId, null); assert.deepEqual((h.current() as any).activeSites, []);
    await act(async () => { finish([{ site: 'kimi', ok: true }]); await sending; });
    assert.equal(h.current().runId, null); assert.deepEqual((h.current() as any).activeSites, []);
  } finally { await h.close(); setShellApi(null); }
});
test('same-run retry replaces only its target attempt without shrinking the visible run scope', async () => {
  const requests: BroadcastRequest[] = [];
  let finish!: (value: SiteRunResult[]) => void;
  setShellApi({ broadcast: (request: BroadcastRequest) => {
    requests.push(request);
    return requests.length === 1 ? Promise.resolve([{ site: 'claude', ok: true }, { site: 'kimi', ok: false, code: 'composer_not_found' }])
      : new Promise(resolve => { finish = resolve; });
  } } as any);
  const h = await probe();
  try {
    await act(async () => { await h.current().send({ text: 'Question', tier: null, sites: ['claude', 'kimi'], images: [] }); });
    let retrying!: Promise<unknown>;
    await act(async () => { retrying = h.current().retry('kimi'); });
    assert.equal(h.current().runId, requests[0].runId);
    assert.deepEqual(requests[1].sites, ['kimi']); assert.deepEqual((h.current() as any).activeSites, ['claude', 'kimi']);
    await act(async () => { finish([{ site: 'kimi', ok: true }]); await retrying; });
    assert.deepEqual((h.current() as any).activeSites, ['claude', 'kimi']);
  } finally { await h.close(); setShellApi(null); }
});
