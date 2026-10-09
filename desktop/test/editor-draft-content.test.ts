import assert from 'node:assert/strict';
import test from 'node:test';
import { parseComparisonContent, parseDecisionContent, parseSynthesisContent } from '../src/renderer/editor-draft-content';

test('recovery permits incomplete decision forms but never binds another source', () => {
  const content = { archiveId: 'a', title: '', conclusion: '', rationale: '', uncertainties: '', nextStep: '', status: 'final', evidence: [] };
  assert.equal(parseDecisionContent(content, 'a')?.title, '');
  assert.equal(parseDecisionContent(content, 'b'), null);
  assert.equal(parseDecisionContent({ ...content, evidence: [{ resultIndex: 30, excerpt: 'x' }] }, 'a'), null);
});
test('comparison recovery retains stale quotations for review and rejects malformed notes', () => {
  const content = { archiveId: 'a', sourceUpdatedAt: 20, quotes: [], categories: {},
    notes: { conclusion: {}, evidence: {}, conditions: {}, cost: {} }, judgment: 'notes', nextStep: '' };
  assert.equal(parseComparisonContent(content, 'a')?.judgment, 'notes');
  assert.equal(parseComparisonContent(content, 'b'), null);
  assert.equal(parseComparisonContent({ ...content, notes: null }, 'a'), null);
});
test('synthesis recovery checks form fields and preserves a missing target for manual correction', () => {
  const content = { selectedHosts: ['x'], targetSite: 'future', tier: null, instruction: 'ask', excerpt: '' };
  assert.equal(parseSynthesisContent(content)?.targetSite, 'future');
  assert.equal(parseSynthesisContent({ ...content, selectedHosts: ['x', 'x'] }), null);
  assert.equal(parseSynthesisContent({ ...content, instruction: {} }), null);
});
