import assert from 'node:assert/strict';
import test from 'node:test';
import { validateArchiveTags as validate } from '../src/renderer/archive-metadata-validation';

test('tag validation preserves comma parsing, empty filtering and original duplicate count', () => {
  assert.deepEqual(validate(' work， research, ,work '), { tags: ['work', 'research', 'work'], overlongIndices: [], tooMany: false });
  assert.deepEqual(validate(''), { tags: [], overlongIndices: [], tooMany: false });
  assert.deepEqual(validate(Array(20).fill('work').join(',')), { tags: Array(20).fill('work'), overlongIndices: [], tooMany: false });
  assert.deepEqual(validate(Array(21).fill('work').join(',')), { tags: Array(21).fill('work'), overlongIndices: [], tooMany: true });
});

test('tag validation accepts 32 emoji codepoints and identifies the exact 33-codepoint item', () => {
  assert.deepEqual(validate('😀'.repeat(32)), { tags: ['😀'.repeat(32)], overlongIndices: [], tooMany: false });
  assert.deepEqual(validate('okay， ' + '😀'.repeat(33) + ',done'),
    { tags: ['okay', '😀'.repeat(33), 'done'], overlongIndices: [1], tooMany: false });
});
