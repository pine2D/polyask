import { COPY } from '../shared/copy';
import { MARKDOWN_EXPORT_CODES, parseMarkdownExport, parseMarkdownPreview, type MarkdownExportCode, type MarkdownExportRequest,
  type MarkdownExportResult, type MarkdownPreviewRequest, type MarkdownDocument } from '../shared/markdown-export';
import { MarkdownSources, assertMarkdownSize, type MarkdownRepositories } from './markdown-export-source';
import { writeReportFile } from './report-file';
interface Options extends MarkdownRepositories {
  readonly epoch: () => number; readonly isCurrent: () => boolean;
  readonly choosePath: (filename: string) => Promise<string | null>;
  readonly writeFile?: typeof writeReportFile; readonly now?: () => number;
}
export class MarkdownExportService {
  private busy = false;
  private disposed = false;
  private readonly sources: MarkdownSources;
  constructor(private readonly options: Options) { this.sources = new MarkdownSources(options); }
  preview(input: MarkdownPreviewRequest): MarkdownDocument[] {
    if (this.disposed || !this.options.isCurrent()) throw new Error('markdown_source_changed');
    const request = parseMarkdownPreview(input), copy = COPY[request.locale ?? 'en'], docs: MarkdownDocument[] = [];
    for (const target of request.targets) {
      try { docs.push(this.sources.preview(target, copy)); }
      catch (error) { if (!request.allowMissing || !(error instanceof Error) || error.message !== 'markdown_not_found') throw error; }
      assertMarkdownSize(JSON.stringify(docs));
    }
    return docs;
  }
  async export(input: MarkdownExportRequest): Promise<MarkdownExportResult> {
    if (this.disposed) return { status: 'cancelled' };
    if (this.busy) return { status: 'failed', code: 'markdown_busy' };
    this.busy = true;
    const epoch = this.options.epoch();
    try {
      const request = parseMarkdownExport(input), copy = COPY[request.locale ?? 'en'];
      const guard = () => {
        if (this.disposed || !this.options.isCurrent() || epoch !== this.options.epoch() ||
          request.selections.some(selection => !this.sources.alive(selection))) throw new Error('markdown_source_changed');
      };
      guard();
      const time = new Date((this.options.now ?? Date.now)()).toISOString();
      const parts = [`# ${copy.markdownFileTitle}`, `${copy.markdownExportedAt}: ${time}`, `> ${copy.markdownScope}`];
      let first: MarkdownDocument | undefined;
      for (const selection of request.selections) {
        const item = this.sources.read(selection, copy); first ??= item.document;
        parts.push(item.markdown); assertMarkdownSize(parts.join('\n\n---\n\n'));
      }
      const content = parts.slice(0, 3).join('\n\n') + '\n\n' + parts.slice(3).join('\n\n---\n\n') + '\n';
      assertMarkdownSize(content);
      const name = request.selections.length === 1 ? first!.title : `${request.selections.length}-${copy.markdownFileTitle}`;
      const suffix = request.selections.length === 1 && request.selections[0].entryIds.length === 1
        ? first!.entries.find(e => e.id === request.selections[0].entryIds[0])?.label ?? '' : '';
      const path = await this.options.choosePath(markdownFilename(name, suffix, time.slice(0, 10)));
      if (!path) return { status: 'cancelled' };
      guard(); await (this.options.writeFile ?? writeReportFile)(path, content, guard);
      return { status: 'saved' };
    } catch (error) {
      if (this.disposed) return { status: 'cancelled' };
      const code = error instanceof Error && MARKDOWN_EXPORT_CODES.includes(error.message as MarkdownExportCode) ? error.message as MarkdownExportCode : 'markdown_failed';
      return { status: 'failed', code };
    } finally { this.busy = false; }
  }
  dispose(): void { this.disposed = true; }
}

/** Bound the whole filename in UTF-8 bytes, keeping the site/date suffix and full codepoints. */
function markdownFilename(title: string, site: string, date: string): string {
  const clean = (value: string) => value.replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, '-').trim().replace(/[. ]+$/g, '');
  const truncate = (value: string, max: number) => {
    let result = '', bytes = 0;
    for (const point of value) { const size = Buffer.byteLength(point, 'utf8'); if (bytes + size > max) break; result += point; bytes += size; }
    return result;
  };
  const label = truncate(clean(site), 48), suffix = `${label ? '-' + label : ''}-${date}.md`;
  const name = clean(truncate(clean(title), 240 - Buffer.byteLength(`PolyAsk-${suffix}`, 'utf8'))) || 'answers';
  return `PolyAsk-${name}${suffix}`;
}
