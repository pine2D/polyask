import { renderMathMarkup } from '../renderer/math-engine';
import type { MathTokenValue } from '../shared/markdown-math-tokens';
import type { ReportPdfOptions } from './report-export-service';

export const REPORT_MATH_LIMIT = 256;
export const reportMathKey = (value: Pick<MathTokenValue, 'source' | 'display'>): string => JSON.stringify([value.source, value.display]);
/** A single formula is bounded by math-engine; yield between formulas for cancellation/source updates. */
export async function renderReportMath(values: ReadonlyMap<string, MathTokenValue>, options: ReportPdfOptions): Promise<Map<string, string>> {
  const results = new Map<string, string>();
  for (const [key, value] of [...values].slice(0, REPORT_MATH_LIMIT)) {
    await new Promise<void>(resolve => setImmediate(resolve));
    options.guard();
    if (options.signal.aborted) throw new Error('report_source_changed');
    const result = renderMathMarkup(value.source, value.display);
    options.guard();
    if (result.ok) results.set(key, result.mathml);
  }
  return results;
}
