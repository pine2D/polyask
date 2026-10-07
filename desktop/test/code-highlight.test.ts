import assert from 'node:assert/strict';
import test from 'node:test';
import { highlightCode } from '../src/renderer/code-highlight';

for (const [language, source, keyword] of [
  ['typescript', 'const n: number = 1; // <b>\n', 'const'],
  ['json', '{"tab": "\\t", "enabled": true}', 'true'],
  ['python', 'def f():\n\treturn "<script>" # note\n', 'def'],
  ['bash', 'if true; then echo "x"; fi # note\n', 'if']
] as const) {
  test('lexical highlighting keeps every character in ' + language, () => {
    const parts = highlightCode(source, language);
    assert.equal(parts !== null, true);
    assert.equal(parts!.map(part => part.text).join(''), source);
    assert.equal(parts!.some(part => part.kind === 'keyword' && part.text === keyword), true);
    assert.equal(parts!.every(part => ['plain', 'keyword', 'string', 'comment', 'number'].includes(part.kind)), true);
  });
}
test('unsupported language and excessive span count fall back to plain code', () => {
  assert.equal(highlightCode('<b>raw</b>', 'future') === null, true);
  assert.equal(highlightCode('x'.repeat(32_769), 'js') === null, true);
  assert.equal(highlightCode('const x=1;\n'.repeat(501), 'js') === null, true);
});
