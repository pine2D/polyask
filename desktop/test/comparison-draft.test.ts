import assert from 'node:assert/strict';
import test from 'node:test';
import { getCopy } from '../src/shared/copy';
import { archiveFixture } from './fixtures';
import { exactExcerpt, excerptSource } from '../src/renderer/answer-excerpt';
import { comparisonDecisionInput, emptyComparisonDraft } from '../src/renderer/comparison-draft';
import { createComparisonDraftStore } from '../src/renderer/comparison-draft-store';
import { validateDecisionDraft } from '../src/renderer/decision-validation';

const record = { ...archiveFixture(), updatedAt: 100, results: [
  { host: 'claude.ai', label: 'Claude', text: null },
  { host: 'chatgpt.com', label: 'ChatGPT', text: 'Second source.' },
  { host: 'www.kimi.com', label: 'Kimi', text: 'Exact literal 😀 evidence.' }
] };
const quote = exactExcerpt(excerptSource(record, 2)!, 0, record.results[2].text!.length)!;
const draft = { ...emptyComparisonDraft(record), quotes: [quote], judgment: 'My own tentative judgment.', nextStep: 'Check the original measurement.',
  notes: { conclusion: {}, evidence: { 'www.kimi.com': 'My evidence assessment.' },
    conditions: { 'www.kimi.com': 'Only if the stated condition holds.' }, cost: { 'chatgpt.com': 'Two hours to check.' } } };

test('manual decision projection retains user judgment, source IDs and literal evidence without inferring a final decision', () => {
  const input = comparisonDecisionInput(record, draft, getCopy('en'))!;
  assert.equal(input.status, 'draft'); assert.equal(input.conclusion, draft.judgment); assert.equal(input.nextStep, draft.nextStep);
  assert.equal(input.evidence[0].resultIndex, 2); assert.equal(input.evidence[0].excerpt === quote.excerpt, true);
  assert.equal(input.rationale.includes('[S3] Kimi'), true); assert.equal(input.rationale.includes('[S2] ChatGPT'), true);
  assert.equal(input.uncertainties.includes('[S3] Kimi'), true);
  assert.equal(comparisonDecisionInput(record, emptyComparisonDraft(record), getCopy('en'))?.conclusion, '');
});

test('manual projection rejects an old source version, a forged literal and duplicate evidence positions', () => {
  assert.equal(comparisonDecisionInput({ ...record, updatedAt: 101 }, draft, getCopy('en')), null);
  assert.equal(comparisonDecisionInput(record, { ...draft, quotes: [{ ...quote, excerpt: 'invented' }] }, getCopy('en')), null);
  assert.equal(comparisonDecisionInput(record, { ...draft, quotes: [quote, quote] }, getCopy('en')), null);
});

test('oversized manual notes remain intact and produce existing decision field validation errors', () => {
  const note = '😀'.repeat(4001), long = { ...draft, notes: { ...draft.notes, evidence: { 'www.kimi.com': note } } };
  const input = comparisonDecisionInput(record, long, getCopy('en'))!;
  assert.equal(input.rationale.includes(note), true);
  assert.equal(validateDecisionDraft(input, record, null).rationale, 'body_too_long');
});

test('a revised source keeps session notes and the old quote marked for review instead of silently replacing it', () => {
  const store = createComparisonDraftStore(); store.save(record, draft);
  const restored = store.restore({ ...record, updatedAt: 101 })!;
  assert.equal(restored.draft.judgment, draft.judgment); assert.equal(restored.draft.quotes[0].excerpt === quote.excerpt, true);
  assert.equal(restored.invalidHosts.join(','), 'www.kimi.com');
  assert.equal(store.restore({ ...record, id: 'B' }), null);
});

test('session store isolates returned edits and versioned cleanup cannot delete newer notes', () => {
  const store = createComparisonDraftStore(), version = store.save(record, draft);
  const restored = store.restore(record)!;
  (restored.draft.notes.evidence as Record<string, string>)['www.kimi.com'] = 'External mutation';
  assert.equal(store.restore(record)!.draft.notes.evidence['www.kimi.com'], 'My evidence assessment.');
  const next = store.save(record, { ...draft, judgment: 'Newer judgment' }); assert.equal(next > version, true);
  store.remove(record.id, version); assert.equal(store.restore(record)!.draft.judgment, 'Newer judgment');
  store.clear(); assert.equal(store.restore(record), null); assert.equal(record.results[2].text, 'Exact literal 😀 evidence.');
});
