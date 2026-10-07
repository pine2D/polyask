import katex from 'katex';
import { mathSourceIssue, MATH_MARKUP_LIMIT, type MathResult } from './math-source';

/** Runs inside the Worker; the caller receives only bounded MathML or a machine reason. */
export function renderMathMarkup(source: string, display: boolean): MathResult {
  const issue = mathSourceIssue(source);
  if (issue) return { ok: false, reason: issue };
  try {
    const markup = katex.renderToString(source, { displayMode: display, output: 'mathml', throwOnError: true,
      trust: false, strict: 'error', macros: {}, globalGroup: false, maxExpand: 256, maxSize: 10 });
    // KaTeX's MathML mode still adds this fixed presentation span; no HTML is forwarded.
    const prefix = '<span class="katex">', suffix = '</span>';
    if (!markup.startsWith(prefix) || !markup.endsWith(suffix)) return { ok: false, reason: 'failed' };
    const mathml = markup.slice(prefix.length, -suffix.length);
    return mathml.length > MATH_MARKUP_LIMIT ? { ok: false, reason: 'limit' } : { ok: true, mathml };
  } catch { return { ok: false, reason: 'failed' }; }
}
