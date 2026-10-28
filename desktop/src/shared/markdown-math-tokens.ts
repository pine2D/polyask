import type MarkdownIt from 'markdown-it';

export interface MathTokenValue { readonly source: string; readonly literal: string; readonly display: boolean }
const missingCloser = new WeakMap<MarkdownIt.StateInline, Map<string, { from: number; max: number }>>();
const missingBlockCloser = new WeakMap<MarkdownIt.StateBlock, Map<string, { from: number; until: number }>>();
function inlineMath(state: MarkdownIt.StateInline, silent: boolean): boolean {
  const start = state.pos, text = state.src;
  if (silent || state.linkLevel > 0) return false;
  const opener = text.startsWith('\\(', start) ? '\\(' : text.startsWith('\\[', start) ? '\\[' : text[start] === '$' && text[start + 1] !== '$' && text[start - 1] !== '$' ? '$' : '';
  if (!opener) return false;
  const closer = opener === '$' ? '$' : opener === '\\(' ? '\\)' : '\\]';
  const keepOpening = () => {
    if (opener === '$') return false;
    state.pending += opener; state.pos += opener.length; return true;
  };
  const missing = missingCloser.get(state)?.get(closer);
  if (missing && missing.max === state.posMax && start >= missing.from) return keepOpening();
  let end = start + opener.length;
  if (opener === '$' && (/\s/.test(text[end] ?? '') || /^\d[\d,.]*(?=\s|$)/.test(text.slice(end)))) return false;
  for (; end < state.posMax; end++) {
    if (text.startsWith(closer, end)) break;
    if (opener === '$' && text[end] === '`') return false;
    if (text[end] === '\\') { end++; continue; }
    if (text[end] === '\n' && (opener === '$' || text[end + 1] === '\n')) return keepOpening();
  }
  if (end >= state.posMax) {
    const bounds = missingCloser.get(state) ?? new Map(); bounds.set(closer, { from: start, max: state.posMax }); missingCloser.set(state, bounds); return keepOpening();
  }
  const source = text.slice(start + opener.length, end);
  if (!source || (opener === '$' && (/\s$/.test(source) || /^[\d\s.,+\-]+$/.test(source) || /\d/.test(text[end + 1] ?? '')))) return false;
  if (!silent) {
    const token = state.push('math_inline', 'math', 0);
    token.content = source; token.meta = { source, literal: text.slice(start, end + closer.length), display: opener === '\\[' };
  }
  state.pos = end + closer.length; return true;
}
function blockMath(state: MarkdownIt.StateBlock, startLine: number, endLine: number, silent: boolean): boolean {
  if (state.sCount[startLine] - state.blkIndent >= 4) return false;
  const begin = state.bMarks[startLine] + state.tShift[startLine], opening = state.src.slice(begin, state.eMarks[startLine]).trim();
  const delimiter = opening.startsWith('$$') && opening.endsWith('$$') && opening.length > 4 ? '$$' :
    opening.startsWith('\\[') && opening.endsWith('\\]') && opening.length > 4 ? '\\[' : '';
  if (delimiter) {
    if (silent) return true;
    const source = opening.slice(2, -2), literal = state.getLines(startLine, startLine + 1, state.blkIndent, false).replace(/\n$/, '');
    const token = state.push('math_block', 'math', 0);
    token.block = true; token.map = [startLine, startLine + 1]; token.content = source; token.meta = { source, literal, display: true };
    state.line = startLine + 1; return true;
  }
  if (opening !== '$$' && opening !== '\\[') return false;
  const closing = opening === '$$' ? '$$' : '\\]';
  // Nested block parsing changes line offsets. Reuse misses only within the same
  // container and scan bound; a blank line ends the reusable missing range.
  const rawLineStart = state.src.lastIndexOf('\n', state.bMarks[startLine] - 1) + 1;
  const containerOffset = state.bMarks[startLine] - rawLineStart;
  const scope = JSON.stringify([closing, endLine, state.blkIndent, state.parentType, containerOffset]);
  const missing = missingBlockCloser.get(state)?.get(scope);
  if (missing && startLine >= missing.from && startLine < missing.until) return false;
  let end = startLine + 1;
  const rememberMissing = () => {
    const bounds = missingBlockCloser.get(state) ?? new Map();
    bounds.set(scope, { from: startLine, until: end }); missingBlockCloser.set(state, bounds);
    return false;
  };
  for (; end < endLine; end++) {
    const line = state.src.slice(state.bMarks[end] + state.tShift[end], state.eMarks[end]).trim();
    if (!line) return rememberMissing();
    if (line === closing) break;
  }
  if (end >= endLine) return rememberMissing();
  if (silent) return true;
  const source = state.getLines(startLine + 1, end, state.blkIndent, false).replace(/\n$/, '');
  const literal = state.getLines(startLine, end + 1, state.blkIndent, false).replace(/\n$/, '');
  const token = state.push('math_block', 'math', 0);
  token.block = true; token.map = [startLine, end + 1]; token.content = source; token.meta = { source, literal, display: true };
  state.line = end + 1; return true;
}
export function addMathTokens(parser: MarkdownIt.MarkdownIt): void {
  parser.inline.ruler.before('escape', 'polyask_math', inlineMath);
  parser.block.ruler.before('fence', 'polyask_math_block', blockMath, { alt: ['paragraph', 'reference', 'blockquote', 'list'] });
}
export function mathTokenValue(token: MarkdownIt.Token): MathTokenValue {
  return { source: token.content, literal: typeof token.meta?.literal === 'string' ? token.meta.literal : token.content, display: token.meta?.display === true };
}
