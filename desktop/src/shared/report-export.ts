import type { DesktopLocale } from './locale';

export type ReportFormat = 'html' | 'pdf';
export interface ReportExportRequest {
  readonly kind: 'archive' | 'decision';
  readonly id: string;
  readonly format: ReportFormat;
  readonly locale?: DesktopLocale;
}
export const REPORT_EXPORT_CODES = [
  'report_not_found', 'report_source_changed', 'report_busy', 'report_too_large',
  'report_pdf_failed', 'report_pdf_timeout', 'report_failed'
] as const;
export type ReportExportCode = typeof REPORT_EXPORT_CODES[number];
export type ReportExportResult = { readonly status: 'saved' } | { readonly status: 'cancelled' }
  | { readonly status: 'failed'; readonly code: ReportExportCode };

export function parseReportExportRequest(value: unknown): ReportExportRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid_request');
  const v = value as Partial<ReportExportRequest>;
  if (Object.keys(v).some(key => !['kind', 'id', 'format', 'locale'].includes(key)) ||
    !['archive', 'decision'].includes(v.kind ?? '') || !['html', 'pdf'].includes(v.format ?? '') ||
    typeof v.id !== 'string' || !v.id.trim() || v.id.length > 128 || /[\u0000-\u001f\u007f]/.test(v.id) ||
    (v.locale !== undefined && !['en', 'zhCN', 'zhTW'].includes(v.locale))) throw new Error('invalid_request');
  return { kind: v.kind!, id: v.id, format: v.format!, locale: v.locale ?? 'en' };
}

export function reportLocaleTag(locale: DesktopLocale = 'en'): string {
  return { en: 'en', zhCN: 'zh-CN', zhTW: 'zh-TW' }[locale];
}
