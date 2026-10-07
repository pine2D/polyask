import assert from 'node:assert/strict';
import test from 'node:test';
import { act, useState } from 'react';
import { SITES } from '../src/main/sites';
import { ArchiveSurface } from '../src/renderer/archive-surface';
import { ExclusiveActionLock } from '../src/renderer/broadcast-flow-state';
import { FeedbackProvider } from '../src/renderer/feedback-provider';
import { useSynthesisFlow } from '../src/renderer/use-synthesis-flow';
import { useSynthesisRecovery } from '../src/renderer/use-synthesis-recovery';
import { setShellApi } from '../src/renderer/shell-api';
import { getCopy } from '../src/shared/copy';
import { createArchiveRecord } from '../src/shared/archive';
import type { SynthesisSendResponse } from '../src/shared/synthesis';
import { mountDom } from './ui/dom-harness';

const copy = getCopy('en');
const record = createArchiveRecord({ text: 'Question', task: 'Task', createdAt: 1,
  results: [{ host: 'claude.ai', label: 'Claude', text: 'Exact excerpt. More context.' }, { host: 'chatgpt.com', label: 'ChatGPT', text: 'Other answer.' }] },
{ id: 'A', now: 1, deviceId: 'fixture' });
const noop = () => undefined;
const pause = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
async function fixture(followUpHost?: string, held = false) {
  let flow!: ReturnType<typeof useSynthesisFlow>;
  let recovery!: ReturnType<typeof useSynthesisRecovery>;
  let attempts = 0;
  let navigate!: (surface: string) => void;
  let finish!: (value: SynthesisSendResponse) => void;
  const failure: SynthesisSendResponse = { result: { site: 'kimi', ok: false, code: 'submit_unconfirmed' }, pending: null };
  setShellApi({ listFolders: async () => [], searchFolderContents: async () => [{ kind: 'archive', record }],
    listArchiveTags: async () => [], getArchive: async () => record,
    sendSynthesis: async () => { attempts++; return held ? new Promise<SynthesisSendResponse>(resolve => { finish = resolve; }) : failure; }
  } as any);
  function App() {
    const [surface, setSurface] = useState('archive');
    navigate = setSurface;
    const [lock] = useState(() => new ExclusiveActionLock());
    flow = useSynthesisFlow(lock);
    const [prepared] = useState(() => {
      flow.drafts.save(record, { selectedHosts: followUpHost ? ['claude.ai'] : ['claude.ai', 'chatgpt.com'],
        targetSite: 'kimi', tier: 'think', instruction: 'Carefully edited requirements 😀', excerpt: 'Exact excerpt.' }, followUpHost);
      return true;
    });
    void prepared;
    recovery = useSynthesisRecovery(copy, flow, () => setSurface('sites'), () => setSurface('archive'));
    return surface === 'sites' ? <div id="target-site">Target site</div> : <ArchiveSurface
      copy={copy} locale="en" sites={SITES} synthesisSites={SITES} defaultTier={null}
      preferredId={recovery.editorRequest?.archiveId ?? record.id} pendingSynthesis={flow.pending} synthesisCandidate={flow.candidate}
      synthesisDrafts={flow.drafts} synthesisEditorRequest={recovery.editorRequest}
      onSynthesisEditorOpened={recovery.consumeEditorRequest}
      onClose={noop} onCapture={async () => record} onSendSynthesis={recovery.send}
      onCollectSynthesis={async () => {}} onSaveSynthesis={async () => record} />;
  }
  const h = await mountDom(<FeedbackProvider copy={copy}><App /></FeedbackProvider>);
  const button = (text: string) => [...h.document.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent?.includes(text))!;
  const until = async (condition: () => unknown) => {
    const deadline = Date.now() + 2000;
    while (!condition() && Date.now() < deadline) await pause();
    assert.ok(condition(), 'expected UI state appears');
  };
  await until(() => button(followUpHost ? copy.followUpAction : copy.synthesisAction));
  await h.click(button(followUpHost ? copy.followUpAction : copy.synthesisAction));
  return { ...h, button, until, flow: () => flow, recovery: () => recovery, attempts: () => attempts,
    navigate: (surface: string) => navigate(surface), finish: (value = failure) => finish(value) };
}

for (const followUpHost of [undefined, 'claude.ai']) test(`failed ${followUpHost ? 'follow-up' : 'synthesis'} returns to the original full editor without resending`, async () => {
  const h = await fixture(followUpHost);
  try {
    const field = () => h.document.querySelector<HTMLTextAreaElement>('[name="synthesis-instruction"]')!;
    await h.input(field(), 'Final requirements kept through failed sending 😀');
    await h.click(h.document.querySelector<HTMLButtonElement>('.synthesis-workspace footer button')!);
    await h.until(() => h.button(copy.synthesisReturnToEdit));
    assert.ok(h.document.getElementById('target-site'));
    assert.equal(h.attempts(), 1);
    await h.click(h.button(copy.synthesisReturnToEdit));
    await h.until(() => field());
    assert.equal(field().value, 'Final requirements kept through failed sending 😀');
    assert.match(h.document.querySelector('[name="synthesis-target"]')!.textContent!, /Kimi/);
    assert.match(h.document.querySelector('[name="synthesis-tier"]')!.textContent!, /Deep/);
    if (followUpHost) assert.equal(h.document.querySelector<HTMLTextAreaElement>('[name="follow-up-excerpt"]')!.value, 'Exact excerpt.');
    assert.equal(h.attempts(), 1, 'returning to edit never retries submission');
  } finally { await h.close(); }
});

test('resetting during a send cannot reinstall the previous draft recovery action', async () => {
  const h = await fixture(undefined, true);
  try {
    await h.click(h.document.querySelector<HTMLButtonElement>('.synthesis-workspace footer button')!);
    await act(async () => { h.recovery().clear(); h.flow().acceptPending(null); h.finish(); });
    await pause();
    assert.equal(Boolean(h.button(copy.synthesisReturnToEdit)), false);
    assert.equal(h.flow().drafts.restore(record), null);
  } finally { await h.close(); }
});

test('late success only clears the sent draft and preserves newer unsent work', async () => {
  const h = await fixture(undefined, true);
  try {
    await h.click(h.document.querySelector<HTMLButtonElement>('.synthesis-workspace footer button')!);
    await act(async () => { h.navigate('archive'); });
    await h.until(() => h.button(copy.synthesisAction));
    await h.click(h.button(copy.synthesisAction));
    await h.input(h.document.querySelector<HTMLTextAreaElement>('[name="synthesis-instruction"]')!, 'NEW unsent work after the earlier request');
    await act(async () => { h.navigate('sites'); });
    assert.equal(h.flow().drafts.restore(record)!.instruction, 'NEW unsent work after the earlier request');
    await act(async () => { h.finish({ result: { site: 'kimi', ok: true }, pending: { archiveId: record.id,
      targetSite: 'kimi', targetHost: 'www.kimi.com', tier: 'think', instruction: 'Carefully edited requirements 😀', sentAt: 1 } }); });
    assert.equal(h.flow().drafts.restore(record)?.instruction, 'NEW unsent work after the earlier request');
    assert.equal(h.attempts(), 1);
  } finally { await h.close(); }
});
