import type { ArchiveRecord } from '../shared/archive';

export interface ExcerptSource {
  readonly archiveId: string;
  readonly sourceUpdatedAt: number;
  readonly resultIndex: number;
  readonly host: string;
  readonly label: string;
  readonly sourceText: string;
  readonly truncated: boolean;
}
export interface ExactExcerpt extends Omit<ExcerptSource, 'sourceText'> {
  readonly start: number;
  readonly end: number;
  readonly excerpt: string;
}
export function excerptSource(record: ArchiveRecord, resultIndex: number): ExcerptSource | null {
  const result = record.results[resultIndex];
  return result?.text?.trim() ? { archiveId: record.id, sourceUpdatedAt: record.updatedAt, resultIndex,
    host: result.host, label: result.label, sourceText: result.text, truncated: result.code === 'answer_truncated' } : null;
}
const boundary = (text: string, index: number) => index === 0 || index === text.length
  || !(text.charCodeAt(index - 1) >= 0xD800 && text.charCodeAt(index - 1) <= 0xDBFF
    && text.charCodeAt(index) >= 0xDC00 && text.charCodeAt(index) <= 0xDFFF);
export function exactExcerpt(source: ExcerptSource, start: number, end: number): ExactExcerpt | null {
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end > source.sourceText.length
    || end <= start || !boundary(source.sourceText, start) || !boundary(source.sourceText, end)) return null;
  const excerpt = source.sourceText.slice(start, end);
  if (!excerpt.trim()) return null;
  const { sourceText: ignored, ...metadata } = source;
  return { ...metadata, start, end, excerpt };
}
// HTML textarea 将 CRLF/CR 显示为 LF；范围始终回映到保存的原文。
export function originalOffset(text: string, displayedOffset: number): number | null {
  if (!Number.isSafeInteger(displayedOffset) || displayedOffset < 0) return null;
  let displayed = 0, original = 0;
  while (displayed < displayedOffset && original < text.length) {
    if (text[original] === '\r' && text[original + 1] === '\n') original += 2;
    else original++;
    displayed++;
  }
  return displayed === displayedOffset ? original : null;
}
export function displayedExcerpt(source: ExcerptSource, start: number, end: number): ExactExcerpt | null {
  const first = originalOffset(source.sourceText, start), last = originalOffset(source.sourceText, end);
  return first === null || last === null ? null : exactExcerpt(source, first, last);
}
export function uniqueExcerpt(source: ExcerptSource, text: string): ExactExcerpt | null {
  if (!text.trim()) return null;
  const start = source.sourceText.indexOf(text);
  return start < 0 || source.sourceText.indexOf(text, start + 1) >= 0 ? null : exactExcerpt(source, start, start + text.length);
}
export function validateExcerpt(record: ArchiveRecord, value: ExactExcerpt): boolean {
  const source = excerptSource(record, value.resultIndex);
  return !!source && source.archiveId === value.archiveId && source.sourceUpdatedAt === value.sourceUpdatedAt
    && source.host === value.host && exactExcerpt(source, value.start, value.end)?.excerpt === value.excerpt;
}
