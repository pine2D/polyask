import assert from 'node:assert/strict';
import test from 'node:test';
import { exactExcerpt, displayedExcerpt, excerptSource, uniqueExcerpt, validateExcerpt } from '../src/renderer/answer-excerpt';
import { archiveFixture } from './fixtures';

const record = { ...archiveFixture(), updatedAt: 100, results: [
  { host: 'claude.ai', label: 'Claude', text: null },
  { host: 'chatgpt.com', label: 'ChatGPT', text: '\r\nA😀\rB\r\nC', code: 'answer_truncated' }
] };
const source = excerptSource(record, 1)!;

test('textarea display offsets map CRLF and lone CR back to saved UTF16 without changing the excerpt', () => {
  const selected = displayedExcerpt(source, 1, 6)!;
  assert.equal(selected.start, 2); assert.equal(selected.end, 7); assert.equal(selected.excerpt, 'A😀\rB');
  assert.equal(selected.resultIndex, 1); assert.equal(selected.truncated, true);
  assert.equal(validateExcerpt(record, selected), true);
});

test('invalid boundaries never accept an empty, out of range or split-surrogate excerpt', () => {
  for (const [start, end] of [[0, 0], [-1, 3], [1.5, 4], [0, 99], [4, 5], [3, 4], [8, 7]])
    assert.equal(exactExcerpt(source, start, end), null);
  assert.equal(displayedExcerpt(source, 3, 4), null);
});

test('rendered matching requires one exact continuous occurrence and does not normalize source whitespace', () => {
  const repeated = { ...source, sourceText: 'Exact claim.\r\nExact claim.' };
  assert.equal(uniqueExcerpt(repeated, 'Exact claim.'), null);
  assert.equal(uniqueExcerpt(source, 'A😀\nB'), null);
  assert.equal(uniqueExcerpt(source, 'A😀')?.excerpt, 'A😀');
});

test('a source range cannot move to another record, version, site or saved answer position', () => {
  const selected = exactExcerpt(source, 2, 5)!;
  assert.equal(validateExcerpt({ ...record, id: 'another-source' }, selected), false);
  assert.equal(validateExcerpt({ ...record, updatedAt: 101 }, selected), false);
  assert.equal(validateExcerpt(record, { ...selected, host: 'claude.ai' }), false);
  assert.equal(validateExcerpt(record, { ...selected, resultIndex: 0 }), false);
  assert.equal(validateExcerpt(record, { ...selected, excerpt: 'invented' }), false);
});

test('the exact range model does not impose the decision evidence limit on follow-up excerpts', () => {
  const text = '😀'.repeat(4001), extended = { ...source, sourceText: text };
  const selected = exactExcerpt(extended, 0, text.length)!;
  assert.equal(selected.excerpt === text, true); assert.equal([...selected.excerpt].length, 4001);
});
