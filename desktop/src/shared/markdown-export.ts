import type { DesktopLocale } from './locale';

export const MAX_MARKDOWN_RECORDS = 100;
export const MAX_MARKDOWN_BYTES = 64 * 1024 * 1024;
export const MARKDOWN_EXPORT_CODES = ['markdown_not_found', 'markdown_source_changed', 'markdown_busy',
  'markdown_too_many', 'markdown_too_large', 'markdown_empty', 'markdown_failed'] as const;
export type MarkdownExportCode = typeof MARKDOWN_EXPORT_CODES[number];
export type MarkdownExportResult = { readonly status: 'saved' } | { readonly status: 'cancelled' }
  | { readonly status: 'failed'; readonly code: MarkdownExportCode };
export interface MarkdownTarget { readonly kind: 'history' | 'archive' | 'decision'; readonly id: string }
export interface MarkdownEntry {
  readonly id: string; readonly site: string; readonly label: string;
  readonly kind: 'answer' | 'synthesis' | 'decision'; readonly available: boolean;
  readonly attempt?: number; readonly latestAttempt?: number; readonly capturedAt: number | null;
  readonly state: string; readonly truncated: boolean; readonly best?: boolean;
}
export interface MarkdownDocument {
  readonly target: MarkdownTarget; readonly revision: string; readonly title: string; readonly createdAt: number; readonly updatedAt: number;
  readonly entries: readonly MarkdownEntry[];
}
export interface MarkdownSelection { readonly target: MarkdownTarget; readonly revision: string; readonly entryIds: readonly string[] }
export interface MarkdownPreviewRequest { readonly targets: readonly MarkdownTarget[]; readonly locale?: DesktopLocale }
export interface MarkdownExportRequest { readonly selections: readonly MarkdownSelection[]; readonly locale?: DesktopLocale }
export const markdownTargetKey = (target: MarkdownTarget): string => `${target.kind}:${target.id}`;
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const id = (v: unknown): v is string => typeof v === 'string' && !!v.trim() && v.length <= 256 && !/[\u0000-\u001f\u007f]/.test(v);
const invalid = (): never => { throw new Error('invalid_request'); };
function fields(v: unknown, keys: string[]): Record<string, unknown> {
  if (!object(v) || Object.keys(v).some(k => !keys.includes(k))) return invalid();
  return v;
}
function target(v: unknown): MarkdownTarget {
  const t = fields(v, ['kind', 'id']);
  if (!['history', 'archive', 'decision'].includes(String(t.kind)) || !id(t.id) || t.id.length > 128) return invalid();
  return { kind: t.kind as MarkdownTarget['kind'], id: t.id };
}
function locale(v: unknown): DesktopLocale {
  if (v === undefined) return 'en';
  if (!['en', 'zhCN', 'zhTW'].includes(String(v))) return invalid();
  return v as DesktopLocale;
}
function bounded(v: unknown): unknown[] {
  if (!Array.isArray(v) || !v.length) return invalid();
  if (v.length > MAX_MARKDOWN_RECORDS) throw new Error('markdown_too_many');
  return v;
}
export function parseMarkdownPreview(value: unknown): MarkdownPreviewRequest {
  const v = fields(value, ['targets', 'locale']), targets = bounded(v.targets).map(target);
  return { targets: [...new Map(targets.map(t => [markdownTargetKey(t), t])).values()], locale: locale(v.locale) };
}
export function parseMarkdownExport(value: unknown): MarkdownExportRequest {
  const v = fields(value, ['selections', 'locale']), seen = new Set<string>();
  const selections = bounded(v.selections).map(input => {
    const s = fields(input, ['target', 'revision', 'entryIds']), t = target(s.target);
    if (typeof s.revision !== 'string' || s.revision.length > 256 || !Array.isArray(s.entryIds) ||
      !s.entryIds.length || s.entryIds.length > 1000 || !s.entryIds.every(id) || seen.has(markdownTargetKey(t))) return invalid();
    seen.add(markdownTargetKey(t));
    return { target: t, revision: s.revision, entryIds: [...new Set(s.entryIds)] as string[] };
  });
  return { selections, locale: locale(v.locale) };
}
