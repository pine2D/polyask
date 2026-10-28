import assert from 'node:assert/strict';
import test from 'node:test';
import { parseMarkdownPreview, parseMarkdownExport } from '../src/shared/markdown-export';
test('export requests accept bounded identities, never renderer bodies or paths', () => {
  const target = { kind: 'history', id: 'q1' }, selection = { target: { kind: 'history', id: 'q1' }, revision: '', entryIds: ['a1', 'a1'] };
  assert.equal(parseMarkdownPreview({ targets: [target, target], locale: 'zhCN' }).targets.length, 1);
  assert.deepEqual(parseMarkdownExport({ selections: [selection] }).selections[0].entryIds, ['a1']);
  for (const value of [{ targets: [target], path: '/tmp/private' }, { targets: [{ ...target, text: 'injected' }] }, { targets: [{ kind: 'other', id: 'x' }] },
    { targets: [{ ...target, id: '\u0000' }] }, { targets: Array.from({ length: 101 }, (_, i) => ({ ...target, id: String(i) })) }]) {
    assert.throws(() => parseMarkdownPreview(value), /invalid_request|markdown_too_many/);
  }
  assert.throws(() => parseMarkdownExport({ selections: [{ ...selection, body: 'injected' }] }), /invalid_request/);
  assert.throws(() => parseMarkdownExport({ selections: [{ ...selection, entryIds: [] }] }), /invalid_request/);
  assert.throws(() => parseMarkdownExport({ selections: [selection, { ...selection, revision: 'different' }] }), /invalid_request/);
});
