import assert from 'node:assert/strict';
import test from 'node:test';
import MarkdownIt from 'markdown-it';
import { addMathTokens } from '../src/renderer/markdown-math-tokens';

function measuredParser() {
  const parser = new MarkdownIt({ html: false, maxNesting: 32 }); addMathTokens(parser);
  const observed = new WeakSet<MarkdownIt.StateBlock>();
  const counts = { reads: 0, silent: 0 };
  // Count real line-index reads through the parser without replacing any production rule.
  parser.block.ruler.before('polyask_math_block', 'measure_line_reads', (state, _start, _end, silent) => {
    if (silent) counts.silent++;
    if (!observed.has(state)) {
      observed.add(state);
      state.bMarks = new Proxy(state.bMarks, { get(target, property, receiver) {
        if (typeof property === 'string' && /^\d+$/.test(property)) counts.reads++;
        return Reflect.get(target, property, receiver);
      } });
    }
    return false;
  }, { alt: ['paragraph', 'reference', 'blockquote', 'list'] });
  return { parser, counts };
}

test('unclosed display openers have a linear total line scan including paragraph lookahead', () => {
  const lines = 800, value = Array.from({ length: lines }, () => '\\[').join('\n');
  const { parser, counts } = measuredParser(); const tokens = parser.parse(value, {});
  assert.equal(tokens.some(token => token.type === 'math_block'), false);
  assert.equal(tokens.find(token => token.type === 'inline')?.content, value);
  assert.equal(counts.silent > 0, true, 'the real paragraph terminator chain exercised silent math lookahead');
  assert.equal(counts.reads <= 64 * lines, true, `line-index reads must be bounded by input lines; observed ${counts.reads}`);
});

test('math block scan bounds retain fences, list formulas and a later formula after an unclosed block', () => {
  const { parser } = measuredParser();
  const tokens = parser.parse('\\[\nx\n\\]\n\n```text\n\\[\nfenced\n\\]\n```\n\n- item\n\n  \\[\n  y+1\n  \\]\n\n\\[\nunclosed\n\n\\[\nz\n\\]', {});
  assert.deepEqual(tokens.filter(token => token.type === 'math_block').map(token => token.content), ['x', 'y+1', 'z']);
  assert.equal(tokens.find(token => token.type === 'fence')?.content, '\\[\nfenced\n\\]\n');
  assert.equal(tokens.some(token => token.type === 'inline' && token.content === '\\[\nunclosed'), true);
  assert.equal(parser.parse('\\[\nafter another parse\n\\]', {}).find(token => token.type === 'math_block')?.content, 'after another parse');
});

test('an outer paragraph miss does not hide a formula inside a later blockquote container', () => {
  const { parser } = measuredParser();
  const tokens = parser.parse('\\[\n\\[\n> note\n> \\[\n> quoted formula\n> \\]', {});
  assert.equal(tokens.find(token => token.type === 'math_block')?.content, 'quoted formula');
  assert.equal(tokens.some(token => token.type === 'blockquote_open'), true);
});
