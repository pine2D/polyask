export type MathFailure = 'limit' | 'busy' | 'timeout' | 'unsupported' | 'failed';
export type MathResult = { readonly ok: true; readonly mathml: string } | { readonly ok: false; readonly reason: MathFailure };
export const MATH_SOURCE_LIMIT = 4096;
export const MATH_MARKUP_LIMIT = 131_072;
const untrustedCommand = /\\(?:href|url|includegraphics|htmlClass|htmlId|htmlStyle|htmlData|def|gdef|edef|xdef|let|futurelet|expandafter|csname|global|newcommand|renewcommand|providecommand|input|include|require|write|openout|usepackage)\b/;

export function mathSourceIssue(source: string): MathFailure | null {
  if (source.length > MATH_SOURCE_LIMIT) return 'limit';
  if (untrustedCommand.test(source)) return 'unsupported';
  let depth = 0;
  for (let i = 0; i < source.length; i++) {
    if (source[i] === '\\' && ['{', '}', '\\'].includes(source[i + 1])) { i++; continue; }
    if (source[i] === '{' && ++depth > 32) return 'limit';
    if (source[i] === '}') depth--;
  }
  return null;
}
