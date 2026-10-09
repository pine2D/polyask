import assert from 'node:assert/strict';
import test from 'node:test';
import { createSynthesisDraftStore, type SynthesisDraft } from '../src/renderer/synthesis-draft';
import { createArchiveRecord } from '../src/shared/archive';

const source = (id = 'A', text = 'Exact excerpt. Context.') => createArchiveRecord({ text: 'Question', task: 'Task', createdAt: 1,
  results: [{ host: 'claude.ai', label: 'Claude', text }, { host: 'chatgpt.com', label: 'ChatGPT', text: 'Another source.' }] },
{ id, now: 1, deviceId: 'fixture' });
const draft: SynthesisDraft = { selectedHosts: ['claude.ai', 'chatgpt.com'], targetSite: 'kimi', tier: 'think', instruction: 'Keep all of my comparison requirements 😀', excerpt: 'Exact excerpt.' };

test('session drafts restore all fields independently for synthesis, follow-up, and other records', () => {
  const store = createSynthesisDraftStore();
  store.save(source(), draft);
  store.save(source(), { ...draft, selectedHosts: ['claude.ai'], instruction: 'Precise follow-up' }, 'claude.ai');
  store.save(source('B'), { ...draft, instruction: 'Other record' });
  assert.deepEqual(store.restore(source()), { ...draft, sourceChanged: false, sourceUpdatedAt: 1 });
  assert.equal(store.restore(source(), 'claude.ai')!.instruction, 'Precise follow-up');
  assert.equal(store.restore(source('B'))!.instruction, 'Other record');
  store.remove('A');
  assert.equal(store.restore(source()), null);
  assert.equal(store.restore(source(), 'claude.ai')!.excerpt, 'Exact excerpt.');
});

test('changed sources are disclosed while original instructions and exact excerpt remain reviewable', () => {
  const store = createSynthesisDraftStore();
  store.save(source(), draft);
  const changed = source('A', 'Replaced source text.');
  const restored = store.restore(changed)!;
  assert.equal(restored.sourceChanged, true);
  assert.equal(restored.instruction, draft.instruction);
  assert.equal(restored.excerpt, draft.excerpt);
  const missing = { ...changed, results: changed.results.slice(1) };
  assert.deepEqual(store.restore(missing)!.selectedHosts, ['chatgpt.com']);
});

test('reset drops every in-memory draft without changing saved records', () => {
  const store = createSynthesisDraftStore();
  const original = source();
  store.save(original, draft);
  store.save(original, draft, 'claude.ai');
  store.clear();
  assert.equal(store.restore(original), null);
  assert.equal(store.restore(original, 'claude.ai'), null);
  assert.equal(original.results[0].text, 'Exact excerpt. Context.');
});

test('saving continued edits cannot erase the original source comparison baseline', () => {
  const store = createSynthesisDraftStore();
  store.save(source(), draft);
  const changed = source('A', 'Exact excerpt. Changed surrounding evidence.');
  store.save(changed, { ...draft, instruction: 'New requirements after source update' });
  assert.equal(store.restore(changed)!.sourceChanged, true);
  assert.equal(store.restore(changed)!.instruction, 'New requirements after source update');
});
