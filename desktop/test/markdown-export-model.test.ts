import assert from 'node:assert/strict';
import test from 'node:test';
import { initialMarkdownSelection, toggleMarkdownSite, toggleMarkdownEntry, chooseMarkdownVersion,
  markdownSelectionRequest, markdownSelectionState, refreshMarkdownSelection } from '../src/renderer/markdown-export-model';
import { entry, documentFixture, exportDocuments } from './markdown-export-fixtures';
const ids = (docs: ReturnType<typeof exportDocuments>, s: ReturnType<typeof initialMarkdownSelection>, order: 'list' | 'oldest' | 'newest' = 'list') => markdownSelectionRequest(docs, s, order).map(x => [x.target.id, ...x.entryIds]);

test('site toggle deselects only that site, partial selects missing groups and preserves chosen attempts', () => {
  const docs = exportDocuments(); let s = initialMarkdownSelection(docs);
  assert.deepEqual(ids(docs, s), [['q1', 'new', 'g1'], ['q2', 'c2', 'g2']]);
  s = chooseMarkdownVersion(docs, s, 'history:q1', 'old');
  s = toggleMarkdownEntry(docs, s, 'history:q2', 'c2');
  assert.equal(markdownSelectionState(docs, s, 'claude'), 'mixed');
  s = toggleMarkdownSite(docs, s, 'claude');
  assert.deepEqual(ids(docs, s), [['q1', 'old', 'g1'], ['q2', 'c2', 'g2']]);
  s = toggleMarkdownSite(docs, s, 'claude');
  assert.deepEqual(ids(docs, s), [['q1', 'g1'], ['q2', 'g2']]);
  s = toggleMarkdownSite(docs, s, 'claude');
  assert.deepEqual(ids(docs, s), [['q1', 'old', 'g1'], ['q2', 'c2', 'g2']], 'rechecking keeps the chosen old attempt');
  s = chooseMarkdownVersion(docs, s, 'history:q1', 'empty');
  assert.deepEqual(ids(docs, s)[0], ['q1', 'old', 'g1'], 'an unavailable version cannot become selected');
});

test('archive duplicate site entries remain distinct and synthesis follows explicit consent', () => {
  const docs = [documentFixture('a', [entry('result:0', 'claude'), entry('result:1', 'claude'),
    entry('synthesis', '__synthesis', { kind: 'synthesis' })], { target: { kind: 'archive', id: 'a' }, revision: 'r1' })];
  let s = initialMarkdownSelection(docs);
  assert.equal(ids(docs, s)[0].length, 4);
  s = toggleMarkdownEntry(docs, s, 'archive:a', 'result:0');
  assert.deepEqual(ids(docs, s), [['a', 'result:1']], 'automatically included synthesis leaves after a source is excluded');
  s = toggleMarkdownEntry(docs, s, 'archive:a', 'synthesis');
  s = toggleMarkdownSite(docs, s, 'claude');
  s = toggleMarkdownSite(docs, s, 'claude');
  assert.deepEqual(ids(docs, s), [['a', 'synthesis']], 'explicit synthesis opt-in survives site selection');
});

test('refresh retains valid identities without selecting new answers or retargeting changed archive indices', () => {
  const docs = exportDocuments(); let s = initialMarkdownSelection(docs);
  s = chooseMarkdownVersion(docs, s, 'history:q1', 'old');
  const next = docs.map((d, i) => i ? d : { ...d, entries: [...d.entries, entry('fourth', 'claude', { attempt: 4 }), entry('gem', 'gemini')] });
  s = refreshMarkdownSelection(docs, next, s);
  assert.deepEqual(ids(next, s)[0], ['q1', 'old', 'g1']);
  const archive = documentFixture('a', [entry('result:0', 'claude')], { target: { kind: 'archive', id: 'a' }, revision: 'r1' });
  assert.equal(markdownSelectionRequest([{ ...archive, revision: 'r2' }], refreshMarkdownSelection([archive], [{ ...archive, revision: 'r2' }], initialMarkdownSelection([archive]))).length, 0);
});

test('stable order and no-text records produce exactly the selected export scope', () => {
  const docs = exportDocuments(); const s = initialMarkdownSelection(docs);
  assert.deepEqual(ids(docs, s, 'newest').map(x => x[0]), ['q2', 'q1']);
  assert.deepEqual(ids(docs, s, 'oldest').map(x => x[0]), ['q1', 'q2']);
  const empty = [documentFixture('empty', [entry('none', 'claude', { available: false })])];
  assert.equal(markdownSelectionState(empty, initialMarkdownSelection(empty)), false);
  assert.equal(markdownSelectionRequest(empty, initialMarkdownSelection(empty)).length, 0);
});
