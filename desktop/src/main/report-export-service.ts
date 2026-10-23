import type { ArchiveService } from './archive-service';
import type { DecisionService } from './decision-service';
import { dateTimeAttribute } from '../shared/format';
import { REPORT_EXPORT_CODES, type ReportExportRequest, type ReportExportResult, type ReportExportCode } from '../shared/report-export';
import { assertReportSize, MAX_REPORT_BYTES, renderReportHtml, type ReportSource } from './report-template';
import { writeReportFile } from './report-file';

export interface ReportPdfOptions {
  readonly signal: AbortSignal;
  readonly guard: () => void;
}
interface ReportExportOptions {
  readonly archives: Pick<ArchiveService, 'get'>;
  readonly decisions: Pick<DecisionService, 'get'>;
  readonly epoch: () => number;
  readonly isCurrent: () => boolean;
  readonly choosePath: (request: ReportExportRequest, filename: string) => Promise<string | null>;
  readonly printPdf: (html: string, options: ReportPdfOptions) => Promise<Uint8Array>;
  readonly writeFile?: typeof writeReportFile;
}
type RecordVersion = { readonly id: string; readonly createdAt: number; readonly updatedAt: number; readonly deviceId: string } | null;
const version = (record: RecordVersion): string => record ? JSON.stringify([record.id, record.createdAt, record.updatedAt, record.deviceId]) : 'missing';

export class ReportExportService {
  private busy = false;
  private disposed = false;
  private active: AbortController | null = null;

  constructor(private readonly options: ReportExportOptions) {}

  async export(request: ReportExportRequest): Promise<ReportExportResult> {
    if (this.disposed) return { status: 'cancelled' };
    if (this.busy) return { status: 'failed', code: 'report_busy' };
    this.busy = true;
    const controller = new AbortController(), epoch = this.options.epoch();
    this.active = controller;
    const lifecycle = () => {
      if (this.disposed || controller.signal.aborted || epoch !== this.options.epoch() || !this.options.isCurrent()) {
        throw new Error('report_source_changed');
      }
    };
    try {
      lifecycle();
      const source = this.read(request);
      if (!source) return { status: 'failed', code: 'report_not_found' };
      assertReportSize(source);
      const archiveVersion = version(source.archive);
      const decisionVersion = version(source.kind === 'decision' ? source.decision : null);
      const guard = () => {
        lifecycle();
        const current = this.read(request);
        if (!current || archiveVersion !== version(current.archive) ||
          decisionVersion !== version(current.kind === 'decision' ? current.decision : null)) throw new Error('report_source_changed');
      };
      const saved = source.kind === 'decision' ? source.decision.createdAt : source.archive.ts;
      const stamp = dateTimeAttribute(saved)?.slice(0, 16).replace(/[T:]/g, '-') ?? 'undated';
      const path = await this.options.choosePath(request, `polyask-${request.kind}-${stamp}.${request.format}`);
      guard();
      if (!path) return { status: 'cancelled' };
      const html = renderReportHtml(source, request.locale);
      let data: Uint8Array | string = html;
      if (request.format === 'pdf') {
        try { data = await this.options.printPdf(html, { signal: controller.signal, guard }); }
        catch (error) {
          guard();
          if (error instanceof Error && REPORT_EXPORT_CODES.includes(error.message as ReportExportCode)) throw error;
          throw new Error('report_pdf_failed');
        }
        guard();
      }
      if (typeof data !== 'string' && data.byteLength > MAX_REPORT_BYTES) throw new Error('report_too_large');
      await (this.options.writeFile ?? writeReportFile)(path, data, guard);
      // writeReportFile 最后一次 guard 与提交之间没有 await；提交后不再把已保存文件误报为失败。
      return { status: 'saved' };
    } catch (error) {
      if (this.disposed || controller.signal.aborted) return { status: 'cancelled' };
      const code = error instanceof Error && REPORT_EXPORT_CODES.includes(error.message as ReportExportCode)
        ? error.message as ReportExportCode : 'report_failed';
      return { status: 'failed', code };
    } finally {
      this.active = null;
      this.busy = false;
    }
  }

  dispose(): void {
    this.disposed = true;
    this.active?.abort();
  }

  private read(request: ReportExportRequest): ReportSource | null {
    if (request.kind === 'archive') {
      const archive = this.options.archives.get(request.id);
      return archive ? { kind: 'archive', archive } : null;
    }
    const decision = this.options.decisions.get(request.id);
    return decision ? { kind: 'decision', decision, archive: this.options.archives.get(decision.archiveId) } : null;
  }
}
