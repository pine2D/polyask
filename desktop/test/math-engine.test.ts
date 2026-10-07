import assert from 'node:assert/strict';
import test from 'node:test';
import { renderMathMarkup } from '../src/renderer/math-engine';
import { mathmlNodes } from '../src/renderer/mathml-nodes';
import { mountTechnical } from './ui/technical-reading-dom';

test('the actual locked KaTeX renders bounded fractions and matrices as safe MathML', async () => {
  const h = await mountTechnical('');
  try {
    for (const source of ['\\frac{1}{2}', '\\begin{matrix}1&2\\\\3&4\\end{matrix}']) {
      const result = renderMathMarkup(source, true);
      assert.equal(result.ok, true);
      if (!result.ok) continue;
      assert.equal(result.mathml.startsWith('<math '), true);
      assert.equal(result.mathml.includes('<span'), false);
      assert.equal(mathmlNodes(result.mathml) !== null, true, 'real KaTeX output passes the same production allowlist');
    }
  } finally { await h.close(); }
});

test('the actual engine preserves a safe failure for bad syntax and untrusted commands', () => {
  for (const [source, reason] of [['\\frac{', 'failed'], ['\\href{https://evil.example}{x}', 'unsupported'],
    ['\\includegraphics{https://evil.example/a}', 'unsupported'], ['\\htmlStyle{position:fixed}{x}', 'unsupported'],
    ['\\gdef\\x{1}\\x', 'unsupported'], ['x'.repeat(4097), 'limit'], ['{'.repeat(33) + 'x' + '}'.repeat(33), 'limit']] as const) {
    const result = renderMathMarkup(source, false);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, reason);
  }
  assert.equal(renderMathMarkup('\\x', false).ok, false, 'a rejected macro definition cannot affect later calls');
});

test('MathML from any backend rejects active nodes and unbounded presentation attributes', async () => {
  const h = await mountTechnical('');
  try {
    for (const body of ['<mi onclick="bad">x</mi>', '<mrow href="https://evil.example"><mi>x</mi></mrow>',
      '<mglyph src="https://evil.example/a"/>', '<mspace width="999999999em"/>']) {
      assert.equal(mathmlNodes('<math xmlns="http://www.w3.org/1998/Math/MathML">' + body + '</math>') === null, true);
    }
  } finally { await h.close(); }
});
