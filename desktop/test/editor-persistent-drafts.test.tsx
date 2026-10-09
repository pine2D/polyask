import assert from 'node:assert/strict';
import test from 'node:test';
import { act } from 'react';
import { DesktopDatabase } from '../src/main/database';
import { DraftRepository } from '../src/main/draft-repository';
import { SITES } from '../src/main/sites';
import { SynthesisWorkspace } from '../src/renderer/synthesis-workspace';
import { DecisionWorkspace } from '../src/renderer/decision-workspace';
import { setShellApi } from '../src/renderer/shell-api';
import { getCopy } from '../src/shared/copy';
import type { DecisionInput, DecisionRecord } from '../src/shared/decision';
import type { StoredDraft } from '../src/shared/drafts';
import { archiveFixture } from './fixtures';
import { mountDom } from './ui/dom-harness';

const source = { ...archiveFixture(), updatedAt: 100, results: [
  { host: 'claude.ai', label: 'Claude', text: 'Exact original excerpt. More context.' },
  { host: 'chatgpt.com', label: 'ChatGPT', text: 'Another original answer.' }
] };
const copy = getCopy('en');
const form = { selectedHosts: ['claude.ai', 'chatgpt.com'], targetSite: 'kimi', tier: null,
  instruction: 'Saved unfinished instructions', excerpt: '' } as const;

function setup() {
  const database = DesktopDatabase.open(':memory:'); database.meta.put('deviceId', 'local');
  let serial = 0;
  const drafts = new DraftRepository(database.state, database.meta, { now: () => 1000, createId: () => `draft-${++serial}` });
  const api = { listDrafts: async (kind?: any, context?: string) => ({ epoch: drafts.epoch(), deviceId: 'local', drafts: drafts.list(kind, context) }),
    saveDraft: async (value: unknown, epoch: number) => drafts.save(value, epoch),
    removeDraft: async (id: string, version: number, epoch: number) => drafts.remove(id, version, epoch),
    onDraftsChanged: () => () => {}, getArchive: async () => source, searchDecisions: async () => [] };
  setShellApi(api as any);
  return { database, drafts, api, close: () => { setShellApi(null); database.close(); } };
}
const button = (document: Document, label: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent === label)!;

test('synthesis recovery is deliberate and only form labor is saved when leaving before debounce', async () => {
  const f = setup();
  f.database.state.put('draft:remote', { format: 1, id: 'remote', deviceId: 'remote', updatedAt: 500,
    kind: 'synthesis', context: JSON.stringify([source.id, null]), title: 'Saved synthesis', content: form, sourceUpdatedAt: 100 }, 500, false);
  const h = await mountDom(<SynthesisWorkspace copy={copy} record={source} sites={SITES} defaultTier={null} busy={false}
    onCancel={() => {}} onSend={() => {}} />);
  try {
    const instruction = h.document.querySelector<HTMLTextAreaElement>('[name="synthesis-instruction"]')!;
    assert.equal(instruction.value, copy.synthesisDefaultInstruction);
    await h.click(button(h.document, copy.draftReview)); await h.click(button(h.document, copy.draftRestore));
    assert.equal(instruction.value, form.instruction);
    await h.input(instruction, 'Last edit before leaving');
    await h.render(null);
    const own = f.drafts.list('synthesis').find(d => d.deviceId === 'local');
    assert.equal((own?.content as { instruction: string }).instruction, 'Last edit before leaving');
    assert.equal(JSON.stringify(own?.content).includes('Another original answer.'), false);
    assert.equal(f.drafts.get('remote')?.deviceId, 'remote');
  } finally { await h.close(); f.close(); }
});

test('synthesis keeps its editing source baseline when saved sources change and provides a sent-version receipt', async () => {
  const f = setup(), receipts: (StoredDraft | null | undefined)[] = [];
  const view = (record = source) => <SynthesisWorkspace copy={copy} record={record} sites={SITES} defaultTier={null} busy={false}
    initialDraft={{ ...form, selectedHosts: [...form.selectedHosts], sourceChanged: false }} onCancel={() => {}}
    onSend={(_request, receipt) => { void Promise.resolve(receipt).then(value => receipts.push(value)); }} />;
  const h = await mountDom(view());
  try {
    await h.click(h.document.querySelector<HTMLButtonElement>('.synthesis-workspace footer button')!);
    assert.equal(receipts.length, 1); assert.equal(receipts[0]?.sourceUpdatedAt, 100);
    await h.render(view({ ...source, updatedAt: 101 }));
    await h.input(h.document.querySelector<HTMLTextAreaElement>('[name="synthesis-instruction"]')!, 'Edited after source change');
    await h.render(null);
    assert.equal(f.drafts.list('synthesis').find(d => d.deviceId === 'local')?.sourceUpdatedAt, 100);
  } finally { await h.close(); f.close(); }
});

test('new default decision forms create no draft while incomplete restored edits survive close', async () => {
  const f = setup();
  const incomplete: DecisionInput = { archiveId: source.id, title: '', conclusion: '', rationale: 'Incomplete reasoning',
    uncertainties: '', nextStep: '', status: 'final', evidence: [] };
  const h = await mountDom(<DecisionWorkspace copy={copy} locale="en" initialSource={source} embedded
    onArchives={() => {}} onClose={() => {}} />);
  try {
    await h.render(null); assert.equal(f.drafts.list('decision').length, 0);
    f.database.state.put('draft:remote-decision', { format: 1, id: 'remote-decision', deviceId: 'remote', updatedAt: 500,
      kind: 'decision', context: `archive:${source.id}`, title: '', content: incomplete, sourceUpdatedAt: 100 }, 500, false);
    await h.render(<DecisionWorkspace copy={copy} locale="en" initialSource={source} embedded onArchives={() => {}} onClose={() => {}} />);
    await h.click(button(h.document, copy.draftReview)); await h.click(button(h.document, copy.draftRestore));
    if (h.document.body.textContent?.includes(copy.draftRestoreConfirm)) await h.click(button(h.document, copy.draftRestore));
    assert.equal(h.document.querySelector<HTMLInputElement>('[name="decision-title"]')!.value, '');
    assert.equal(h.document.querySelector<HTMLTextAreaElement>('[name="decision-rationale"]')!.value, 'Incomplete reasoning');
    await h.render(null);
    assert.equal((f.drafts.list('decision').find(d => d.deviceId === 'local')?.content as DecisionInput).title, '');
  } finally { await h.close(); f.close(); }
});

test('formal decision success clears its captured draft and preserves the remote recovery copy', async () => {
  const f = setup();
  const value: DecisionInput = { archiveId: source.id, title: 'Deliberate choice', conclusion: 'A valid conclusion',
    rationale: 'Edited reasoning', uncertainties: '', nextStep: '', status: 'draft', evidence: [] };
  setShellApi({ ...f.api, createDecision: async (input: DecisionInput): Promise<DecisionRecord> => ({ ...input,
    id: 'decision-created', evidence: [], sourceTitle: source.task, createdAt: 1000, updatedAt: 1000, deviceId: 'local', schema: 2 }) } as any);
  f.database.state.put('draft:remote', { format: 1, id: 'remote', deviceId: 'remote', updatedAt: 500,
    kind: 'decision', context: `archive:${source.id}`, title: value.title, content: value, sourceUpdatedAt: 100 }, 500, false);
  const h = await mountDom(<DecisionWorkspace copy={copy} locale="en" initialSource={source} initialDraft={value} embedded onArchives={() => {}} onClose={() => {}} />);
  try {
    await act(async () => { await Promise.resolve(); });
    await h.click(button(h.document, copy.decisionSave));
    assert.equal(f.drafts.get('draft-1')?.deletedAt, 1001);
    assert.equal(f.drafts.get('remote')?.deletedAt, undefined);
    assert.ok(h.document.body.textContent?.includes(copy.decisionSaved));
  } finally { await h.close(); f.close(); }
});

test('unanswered draft IPC does not block synthesis sending or formal decision saving', async () => {
  const f = setup();
  let synthesisSends = 0, decisionSaves = 0;
  let finish!: () => void;
  setShellApi({ ...f.api, saveDraft: (input: unknown, epoch: number) => {
    const saved = f.drafts.save(input, epoch); return new Promise<StoredDraft>(resolve => { finish = () => resolve(saved); });
  }, createDecision: async (input: DecisionInput): Promise<DecisionRecord> => {
    decisionSaves++; return { ...input, id: 'saved-card', evidence: [], sourceTitle: source.task,
      createdAt: 1000, updatedAt: 1000, deviceId: 'local', schema: 2 };
  } } as any);
  const h = await mountDom(<SynthesisWorkspace copy={copy} record={source} sites={SITES} defaultTier={null} busy={false}
    initialDraft={{ ...form, selectedHosts: [...form.selectedHosts], sourceChanged: false }} onCancel={() => {}}
    onSend={() => { synthesisSends++; }} />);
  try {
    await h.click(h.document.querySelector<HTMLButtonElement>('.synthesis-workspace footer button')!);
    assert.equal(synthesisSends, 1);
    await act(async () => finish());
    const value: DecisionInput = { archiveId: source.id, title: 'Save despite draft failure', conclusion: '',
      rationale: 'Actual work', uncertainties: '', nextStep: '', status: 'draft', evidence: [] };
    await h.render(<DecisionWorkspace copy={copy} locale="en" initialSource={source} initialDraft={value} embedded onArchives={() => {}} onClose={() => {}} />);
    await h.click(button(h.document, copy.decisionSave));
    assert.equal(decisionSaves, 1);
    assert.ok(h.document.body.textContent?.includes(copy.decisionSaved));
    await act(async () => finish());
  } finally { await h.close(); f.close(); }
});
