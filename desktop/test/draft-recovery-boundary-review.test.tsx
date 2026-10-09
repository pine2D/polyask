import assert from 'node:assert/strict';
import test from 'node:test';
import { DesktopDatabase } from '../src/main/database';
import { DraftRepository } from '../src/main/draft-repository';
import { SITES } from '../src/main/sites';
import { parseComparisonContent, parseDecisionContent, parseSynthesisContent } from '../src/renderer/editor-draft-content';
import { DecisionWorkspace } from '../src/renderer/decision-workspace';
import { SynthesisWorkspace } from '../src/renderer/synthesis-workspace';
import { setShellApi } from '../src/renderer/shell-api';
import { getCopy } from '../src/shared/copy';
import { archiveFixture } from './fixtures';
import { mountDom } from './ui/dom-harness';

test('decision recovery retains the empty evidence field produced by adding unfinished evidence', () => {
  const restored = parseDecisionContent({ archiveId: 'source', title: 'Work in progress',
    conclusion: '', rationale: 'Unfinished reasoning', uncertainties: '', nextStep: '', status: 'draft',
    evidence: [{ resultIndex: 0, excerpt: '' }] }, 'source');
  assert.equal(restored?.evidence[0]?.excerpt, '');
});

test('decision recovery preserves over-limit editing text for correction before formal save', () => {
  const rationale = 'r'.repeat(4001), title = 't'.repeat(161), excerpt = 'e'.repeat(4001);
  const restored = parseDecisionContent({ archiveId: 'source', title, conclusion: '', rationale,
    uncertainties: '', nextStep: '', status: 'draft', evidence: [{ resultIndex: 0, excerpt }] }, 'source');
  assert.equal(restored?.title, title);
  assert.equal(restored?.rationale, rationale);
  assert.equal(restored?.evidence[0]?.excerpt, excerpt);
});

test('comparison recovery preserves over-limit notes and exact quotations for manual correction', () => {
  const text = 'n'.repeat(4001);
  const restored = parseComparisonContent({ archiveId: 'source', sourceUpdatedAt: 100,
    quotes: [{ archiveId: 'source', sourceUpdatedAt: 100, resultIndex: 0, start: 0, end: 4001,
      host: 'claude.ai', label: 'Claude', excerpt: text, truncated: false }], categories: {},
    notes: { conclusion: { 'claude.ai': text }, evidence: {}, conditions: {}, cost: {} },
    judgment: text, nextStep: text }, 'source');
  assert.equal(restored?.judgment.length, 4001);
  assert.equal(restored?.notes.conclusion['claude.ai']?.length, 4001);
  assert.equal(restored?.quotes[0]?.excerpt.length, 4001);
});

test('follow-up recovery preserves over-limit editing excerpts for correction before send', () => {
  const restored = parseSynthesisContent({ selectedHosts: ['claude.ai'], targetSite: 'kimi', tier: null,
    instruction: 'Unfinished question', excerpt: 'e'.repeat(4001) });
  assert.equal(restored?.excerpt.length, 4001);
});

test('decision autosave keeps full editing labor when its title exceeds the formal-save limit', async () => {
  const source = archiveFixture();
  const database = DesktopDatabase.open(':memory:'); database.meta.put('deviceId', 'local');
  const repository = new DraftRepository(database.state, database.meta);
  const title = 't'.repeat(161);
  setShellApi({
    listDrafts: async (kind?: any, context?: string) => ({ epoch: repository.epoch(), deviceId: 'local', drafts: repository.list(kind, context) }),
    saveDraft: async (input: unknown, epoch: number) => repository.save(input, epoch),
    onDraftsChanged: () => () => {}, getArchive: async () => source
  } as any);
  const h = await mountDom(<DecisionWorkspace copy={getCopy('en')} locale="en" embedded initialSource={source}
    initialDraft={{ archiveId: source.id, title, conclusion: '', rationale: 'Keep my unfinished reasoning',
      uncertainties: '', nextStep: '', status: 'draft', evidence: [] }} onArchives={() => {}} onClose={() => {}} />);
  try {
    await h.render(null);
    assert.equal((repository.list('decision')[0]?.content as { title?: string } | undefined)?.title, title);
    assert.equal(repository.list('decision')[0]?.title.length, 160);
  } finally { await h.close(); setShellApi(null); database.close(); }
});

for (const missing of ['target', 'source'] as const) test(`synthesis recovery retains editing labor when the ${missing} is unavailable`, async () => {
  const copy = getCopy('en');
  const original = { ...archiveFixture(), updatedAt: 100, results: [
    { host: 'claude.ai', label: 'Claude', text: 'Original first answer' },
    { host: 'chatgpt.com', label: 'ChatGPT', text: 'Original second answer' }
  ] };
  const record = missing === 'source' ? { ...original, updatedAt: 101, results: original.results.slice(0, 1) } : original;
  const database = DesktopDatabase.open(':memory:'); database.meta.put('deviceId', 'local');
  const repository = new DraftRepository(database.state, database.meta);
  database.state.put('draft:remote', { format: 1, id: 'remote', deviceId: 'other', updatedAt: 500,
    kind: 'synthesis', context: JSON.stringify([original.id, null]), title: 'Unfinished synthesis', sourceUpdatedAt: 100,
    content: { selectedHosts: ['claude.ai', 'chatgpt.com'], targetSite: 'kimi', tier: null,
      instruction: 'Keep my unfinished synthesis instructions', excerpt: '' }
  }, 500, false);
  setShellApi({
    listDrafts: async (kind?: any, context?: string) => ({ epoch: repository.epoch(), deviceId: 'local', drafts: repository.list(kind, context) }),
    saveDraft: async (input: unknown, epoch: number) => repository.save(input, epoch),
    removeDraft: async (id: string, version: number, epoch: number) => repository.remove(id, version, epoch),
    onDraftsChanged: () => () => {}
  } as any);
  const h = await mountDom(<SynthesisWorkspace copy={copy} record={record} sites={missing === 'target' ? SITES.filter(site => site.key !== 'kimi') : SITES}
    defaultTier={null} busy={false} onCancel={() => {}} onSend={() => {}} />);
  const button = (label: string) => [...h.document.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent === label)!;
  try {
    await h.click(button(copy.draftReview)); await h.click(button(copy.draftRestore));
    if (h.document.querySelector('.draft-confirm')) await h.click(button(copy.draftRestore));
    assert.equal(h.document.querySelector<HTMLTextAreaElement>('[name="synthesis-instruction"]')?.value,
      'Keep my unfinished synthesis instructions');
    assert.equal(h.document.querySelector<HTMLButtonElement>('.synthesis-workspace footer button')?.disabled, true);
  } finally { await h.close(); setShellApi(null); database.close(); }
});
