import assert from 'node:assert/strict';
import test from 'node:test';
import { SITES } from '../src/main/sites';
import { SynthesisWorkspace } from '../src/renderer/synthesis-workspace';
import { createSynthesisDraftStore } from '../src/renderer/synthesis-draft';
import { getCopy } from '../src/shared/copy';
import { createArchiveRecord } from '../src/shared/archive';
import { mountDom } from './ui/dom-harness';

const copy = getCopy('en');
const source = createArchiveRecord({ text: 'Question', task: 'Task', createdAt: 1,
  results: [{ host: 'claude.ai', label: 'Claude', text: 'Exact excerpt. More context.' }, { host: 'chatgpt.com', label: 'ChatGPT', text: 'Other answer.' }] },
{ id: 'A', now: 1, deviceId: 'fixture' });
const noop = () => undefined;

test('restored synthesis and follow-up fields survive unmounting, editing, and returning', async () => {
  for (const followUpHost of [undefined, 'claude.ai']) {
    const store = createSynthesisDraftStore();
    store.save(source, { selectedHosts: followUpHost ? ['claude.ai'] : ['claude.ai', 'chatgpt.com'],
      targetSite: 'kimi', tier: 'think', instruction: 'Carefully edited instructions 😀', excerpt: 'Exact excerpt.' }, followUpHost);
    const view = () => <SynthesisWorkspace copy={copy} record={source} sites={SITES} defaultTier={null}
      followUpHost={followUpHost} busy={false} onCancel={noop} onSend={noop}
      initialDraft={store.restore(source, followUpHost)} onDraftChange={draft => store.save(source, draft, followUpHost)} />;
    const h = await mountDom(view());
    try {
      const instruction = () => h.document.querySelector<HTMLTextAreaElement>('[name="synthesis-instruction"]')!;
      assert.equal(instruction().value, 'Carefully edited instructions 😀');
      assert.match(h.document.querySelector('[name="synthesis-target"]')!.textContent!, /Kimi/);
      assert.match(h.document.querySelector('[name="synthesis-tier"]')!.textContent!, /Deep/);
      if (followUpHost) assert.equal(h.document.querySelector<HTMLTextAreaElement>('[name="follow-up-excerpt"]')!.value, 'Exact excerpt.');
      await h.input(instruction(), 'Additional requirements preserved after failure');
      await h.render(null);
      await h.render(view());
      assert.equal(instruction().value, 'Additional requirements preserved after failure');
      assert.match(h.document.querySelector('[name="synthesis-target"]')!.textContent!, /Kimi/);
    } finally { await h.close(); }
  }
});

test('a changed source does not silently validate a restored follow-up excerpt', async () => {
  const store = createSynthesisDraftStore();
  store.save(source, { selectedHosts: ['claude.ai'], targetSite: 'kimi', tier: null,
    instruction: 'Keep my question', excerpt: 'Exact excerpt.' }, 'claude.ai');
  const changed = { ...source, results: [{ ...source.results[0], text: 'Completely different source.' }] };
  const h = await mountDom(<SynthesisWorkspace copy={copy} record={changed} sites={SITES} defaultTier={null}
    followUpHost="claude.ai" busy={false} onCancel={noop} onSend={noop}
    initialDraft={store.restore(changed, 'claude.ai')} onDraftChange={noop} />);
  try {
    assert.equal(h.document.querySelector<HTMLTextAreaElement>('[name="follow-up-excerpt"]')!.value, 'Exact excerpt.');
    assert.ok(h.document.querySelector('.synthesis-source-changed'), 'source change needs review');
    assert.equal(h.document.querySelector<HTMLButtonElement>('.synthesis-workspace footer button')!.disabled, true);
  } finally { await h.close(); }
});

test('source replacement while the same follow-up editor remains open is disclosed', async () => {
  const initialDraft = { selectedHosts: ['claude.ai'], targetSite: 'kimi', tier: null,
    instruction: 'Keep my current question', excerpt: 'Exact excerpt.', sourceChanged: false };
  const view = (record: typeof source) => <SynthesisWorkspace copy={copy} record={record} sites={SITES} defaultTier={null}
    followUpHost="claude.ai" busy={false} onCancel={noop} onSend={noop} initialDraft={initialDraft} onDraftChange={noop} />;
  const h = await mountDom(view(source));
  try {
    const changed = { ...source, results: [{ ...source.results[0], text: 'Changed during editing.' }] };
    await h.render(view(changed));
    assert.ok(h.document.querySelector('.synthesis-source-changed'), 'open editors disclose changed saved evidence');
    assert.equal(h.document.querySelector<HTMLTextAreaElement>('[name="synthesis-instruction"]')!.value, initialDraft.instruction);
    assert.equal(h.document.querySelector<HTMLButtonElement>('.synthesis-workspace footer button')!.disabled, true);
  } finally { await h.close(); }
});
