import { dialog, ipcMain, type BrowserWindow } from 'electron';
import { parseReportExportRequest } from '../shared/report-export';
import type { ArchiveService } from './archive-service';
import type { DecisionService } from './decision-service';
import { ReportExportService } from './report-export-service';
import { printReportPdf } from './report-pdf';

interface ReportIpcEvent {
  readonly sender: Electron.WebContents;
  readonly senderFrame: Electron.WebFrameMain | null;
}
export function registerReportExportIpc(options: {
  readonly window: BrowserWindow;
  readonly archives: Pick<ArchiveService, 'get'>;
  readonly decisions: Pick<DecisionService, 'get'>;
  readonly trusted: (event: ReportIpcEvent) => boolean;
  readonly epoch: () => number;
  readonly isCurrent: () => boolean;
}): () => void {
  const service = new ReportExportService({ ...options, printPdf: printReportPdf,
    choosePath: async (request, filename) => {
      const result = await dialog.showSaveDialog(options.window, { defaultPath: filename,
        filters: [{ name: request.format.toUpperCase(), extensions: [request.format] }] });
      return result.canceled || !result.filePath ? null : result.filePath;
    } });
  ipcMain.handle('polyask:report-export', (event, value: unknown) => {
    if (!options.trusted(event)) throw new Error('untrusted_sender');
    return service.export(parseReportExportRequest(value));
  });
  return () => { service.dispose(); ipcMain.removeHandler('polyask:report-export'); };
}
