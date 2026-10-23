import { useLayoutEffect, useRef } from 'react';
import type { DesktopCopy } from '../shared/copy';
import { resolveLocale } from '../shared/locale';
import type { ReportExportRequest, ReportExportResult, ReportFormat } from '../shared/report-export';
import { shell } from './shell-api';

export function reportExportMessage(copy: DesktopCopy, result: ReportExportResult): string {
  if (result.status === 'saved') return copy.reportExported;
  if (result.status === 'cancelled') return copy.reportCancelled;
  const messages = { report_not_found: copy.reportNotFound, report_source_changed: copy.reportSourceChanged,
    report_busy: copy.reportBusy, report_too_large: copy.reportTooLarge, report_pdf_failed: copy.reportPdfFailed,
    report_pdf_timeout: copy.reportPdfTimeout, report_failed: copy.reportFailed };
  return messages[result.code] ?? copy.reportFailed;
}

export function reportExportActions(copy: DesktopCopy, onExport: (format: ReportFormat) => void) {
  return [
    { label: copy.reportExportHtml, run: () => onExport('html') },
    { label: copy.reportExportPdf, run: () => onExport('pdf') }
  ];
}

export function useReportExport(options: {
  readonly kind: ReportExportRequest['kind']; readonly id: string | undefined;
  readonly locale: string; readonly copy: DesktopCopy; readonly onStatus: (message: string) => void;
}) {
  const current = useRef(options), epoch = useRef(0), mounted = useRef(false);
  useLayoutEffect(() => { current.current = options; });
  useLayoutEffect(() => {
    mounted.current = true; epoch.current++;
    return () => { mounted.current = false; epoch.current++; };
  }, [options.kind, options.id]);
  return async (format: ReportFormat): Promise<void> => {
    const captured = current.current, ticket = ++epoch.current;
    if (!captured.id || !mounted.current) return;
    captured.onStatus(captured.copy.reportExporting);
    let result: ReportExportResult;
    try {
      result = await shell.exportReport({ kind: captured.kind, id: captured.id, format, locale: resolveLocale(captured.locale) });
    } catch { result = { status: 'failed', code: 'report_failed' }; }
    if (mounted.current && ticket === epoch.current) current.current.onStatus(reportExportMessage(current.current.copy, result));
  };
}
