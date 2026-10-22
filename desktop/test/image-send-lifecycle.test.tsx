import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { act } from 'react';
import { useImageSelection } from '../src/renderer/use-image-selection';
import { useBroadcastFlow } from '../src/renderer/use-broadcast-flow';
import { ExclusiveActionLock } from '../src/renderer/broadcast-flow-state';
import { DraftRevision } from '../src/renderer/prompt-draft';
import { setShellApi } from '../src/renderer/shell-api';
import { getCopy } from '../src/shared/copy';
import type { BroadcastRequest, SiteRunResult, SiteStatus } from '../src/shared/protocol';
import { readSource } from './fixtures';
import { mountDom } from './ui/dom-harness';

const noop = () => undefined;
const source = readSource('src/renderer/index.tsx');
const submitSource = ts.transpileModule(
  `${source.slice(source.indexOf('  const submit ='), source.indexOf('  const setMode ='))}\nsubmit();`,
  { compilerOptions: { target: ts.ScriptTarget.ES2022 } }
).outputText;
const success: SiteRunResult[] = [{ site: 'claude', ok: true }, { site: 'kimi', ok: true }];
const failed: SiteRunResult[] = [{ site: 'claude', ok: false, code: 'attachment_failed' }, { site: 'kimi', ok: false, code: 'not_ready' }];

async function fixture() {
  let images!: ReturnType<typeof useImageSelection>, flow!: ReturnType<typeof useBroadcastFlow>;
  let finish!: (results: readonly SiteRunResult[]) => void, reject!: (error: Error) => void;
  let task: Promise<unknown> = Promise.resolve(), draft = 'First question';
  const requests: BroadcastRequest[] = [], revision = new DraftRevision(), lock = new ExclusiveActionLock();
  setShellApi({ broadcast: (request: BroadcastRequest) => {
    requests.push(request);
    return new Promise<readonly SiteRunResult[]>((resolve, fail) => { finish = resolve; reject = fail; });
  }, cancel: noop } as any);
  function Fixture() {
    flow = useBroadcastFlow(noop, noop, noop, noop);
    images = useImageSelection(getCopy('en'), flow.runState === 'idle', noop);
    return <output>{images.images.length}</output>;
  }
  const h = await mountDom(<Fixture />);
  const file = (name: string) => new h.window.File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], name, { type: 'image/png' });
  const choose = async (name: string) => { await act(async () => { await images.choose([file(name)]); }); };
  await choose('first.png');
  return { ...h, requests, flow: () => flow, images: () => images, file,
    choose, names: () => images.images.map(image => image.name), draft: () => draft,
    edit: (value: string) => { revision.edit(); draft = value; },
    send: async () => { await act(async () => {
      task = vm.runInNewContext(submitSource, {
        text: draft, draftRevision: revision, runState: flow.runState,
        draftConfirmation: { isBlocking: () => false },
        participation: { currentSites: () => ['claude', 'kimi'], pending: false },
        actionLock: { current: lock }, imageWarning: null, imageSelection: images,
        workspace: { tier: null }, images: images.images, broadcast: flow,
        flushDraft: () => Promise.resolve(null), composer: { reset: noop },
        clearSent: (sent: number) => { if (revision.isCurrent(sent)) { revision.edit(); draft = ''; } }
      });
    }); },
    retry: async () => { await act(async () => { task = flow.retry(); }); },
    finish: async (results: readonly SiteRunResult[]) => { await act(async () => { finish(results); await task; }); },
    reject: async () => { await act(async () => { reject(new Error('transport failed')); await task; }); },
    late: async (runId = requests[0].runId) => { await act(async () => flow.acceptStatus({
      site: 'kimi', phase: 'submitted', submission: { runId, state: 'sent' }
    } as SiteStatus)); },
    close: async () => { await h.close(); setShellApi(null); }
  };
}

for (const outcome of [
  { name: 'success', results: success, clears: true },
  { name: 'partial success', results: [success[0], failed[1]], clears: true },
  { name: 'tier warning', results: [{ site: 'kimi', ok: true, code: 'tier_unconfirmed' }] as SiteRunResult[], clears: true },
  { name: 'all failed', results: failed, clears: false },
  { name: 'cancelled', results: [{ site: 'kimi', ok: false, code: 'cancelled' }] as SiteRunResult[], clears: false },
  { name: 'unconfirmed', results: [{ site: 'kimi', ok: false, code: 'submit_unconfirmed' }] as SiteRunResult[], clears: false },
  { name: 'missing reply', results: [], clears: false }
]) test(`${outcome.name}: next question carries only unsent images without starting a new session`, async () => {
  const h = await fixture();
  try {
    await h.send();
    assert.deepEqual(h.requests[0].images.map(image => image.name), ['first.png']);
    assert.deepEqual(h.names(), ['first.png'], 'pending submission retains its attachments');
    await h.finish(outcome.results);
    assert.deepEqual(h.names(), outcome.clears ? [] : ['first.png']);
    h.edit('Second question'); await h.send();
    assert.deepEqual(h.requests[1].images.map(image => image.name), outcome.clears ? [] : ['first.png']);
    assert.notEqual(h.requests[1].runId, h.requests[0].runId);
    await h.finish([]);
  } finally { await h.close(); }
});

test('editing the next question while sending keeps its text but removes the sent images', async () => {
  const h = await fixture();
  try {
    await h.send(); h.edit('Next draft'); await h.finish(success);
    assert.equal(h.draft(), 'Next draft'); assert.deepEqual(h.names(), []);
  } finally { await h.close(); }
});

test('retry uses frozen original images after partial success cleared the composer', async () => {
  const h = await fixture();
  try {
    await h.send(); await h.finish([success[0], failed[1]]);
    assert.deepEqual(h.names(), []);
    await h.choose('next.png'); h.edit('Next draft');
    await h.retry();
    assert.deepEqual(h.requests[1].sites, ['kimi']);
    assert.deepEqual(h.requests[1].images.map(image => image.name), ['first.png']);
    await h.finish([success[1]]);
    assert.deepEqual(h.names(), ['next.png']); assert.equal(h.draft(), 'Next draft');
  } finally { await h.close(); }
});

test('first successful retry clears retained images and the original draft', async () => {
  const h = await fixture();
  try {
    await h.send(); await h.finish(failed); await h.retry(); await h.finish(success);
    assert.deepEqual(h.names(), []); assert.equal(h.draft(), '');
    assert.equal(h.requests[1].runId, h.requests[0].runId);
    assert.deepEqual(h.requests[1].images.map(image => image.name), ['first.png']);
  } finally { await h.close(); }
});

test('late submission confirmation clears retained images without dispatching again', async () => {
  const h = await fixture();
  try {
    await h.send(); await h.finish([{ site: 'kimi', ok: false, code: 'submit_unconfirmed' }]);
    await h.late();
    assert.deepEqual(h.names(), []); assert.equal(h.requests.length, 1);
  } finally { await h.close(); }
});

test('submission evidence arriving before the IPC reply also clears only after the run settles', async () => {
  const h = await fixture();
  try {
    await h.send(); await h.late(); assert.deepEqual(h.names(), ['first.png']);
    await h.finish([{ site: 'kimi', ok: false, code: 'submit_unconfirmed' }]);
    assert.deepEqual(h.names(), []);
  } finally { await h.close(); }
});

test('an old success preserves a newer selection even when it reuses the same image objects', async () => {
  const h = await fixture();
  try {
    await h.send(); await h.finish(failed);
    const sameImages = h.images().images;
    await act(async () => h.images().replace(sameImages));
    await h.retry(); await h.finish(success);
    assert.deepEqual(h.names(), ['first.png']);
  } finally { await h.close(); }
});

test('a late success cannot cancel a newer image read or native picker intent', async () => {
  const h = await fixture();
  try {
    await h.send(); await h.finish([{ site: 'kimi', ok: false, code: 'submit_unconfirmed' }]);
    await act(async () => {
      const reading = h.images().choose([h.file('next.png')], 'append');
      h.flow().acceptStatus({ site: 'kimi', phase: 'submitted', submission: { runId: h.requests[0].runId, state: 'sent' } });
      await reading;
    });
    assert.deepEqual(h.names(), ['next.png'], 'new reads must not resurrect an image consumed during the read');
    h.edit('Another question'); await h.send(); await h.finish(failed);
    let intent = 0;
    await act(async () => { intent = h.images().beginPick(); });
    await h.retry(); await h.finish(success);
    assert.equal(h.images().intent(), intent);
    assert.deepEqual(h.names(), [], 'cancelling a native picker must not leave already sent images selected');
  } finally { await h.close(); }
});

test('invalid new files do not keep already sent images selected after a late confirmation', async () => {
  const h = await fixture();
  try {
    await h.send(); await h.finish([{ site: 'kimi', ok: false, code: 'submit_unconfirmed' }]);
    await act(async () => { await h.images().choose([new h.window.File(['bad'], 'bad.png', { type: 'image/png' })]); });
    await h.late();
    assert.deepEqual(h.names(), []);
  } finally { await h.close(); }
});

test('closing the tray or changing surfaces does not turn sent images into a new draft', async () => {
  const h = await fixture();
  try {
    await h.send(); await act(async () => h.images().invalidateAndClose()); await h.finish(success);
    assert.deepEqual(h.names(), []);
  } finally { await h.close(); }
});

test('transport failure and invalidated replies retain unsent images', async () => {
  const h = await fixture();
  try {
    await h.send(); await h.reject(); assert.deepEqual(h.names(), ['first.png']);
    await h.send(); await act(async () => h.flow().invalidate()); await h.finish(success);
    assert.deepEqual(h.names(), ['first.png']);
    await h.late(); assert.deepEqual(h.names(), ['first.png']);
  } finally { await h.close(); }
});
