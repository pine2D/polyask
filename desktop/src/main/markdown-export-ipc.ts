import { dialog, ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron';
import { MARKDOWN_EXPORT_CODES, parseMarkdownExport, parseMarkdownPreview } from '../shared/markdown-export';
import { MarkdownExportService } from './markdown-export-service';
import type { MarkdownRepositories } from './markdown-export-source';
export function registerMarkdownExportIpc(options: MarkdownRepositories & {
  readonly window: BrowserWindow; readonly trusted: (event: IpcMainInvokeEvent) => boolean;
  readonly epoch: () => number; readonly isCurrent: () => boolean;
}): () => void {
  const service = new MarkdownExportService({ ...options, choosePath: async filename => {
    const result = await dialog.showSaveDialog(options.window, { defaultPath: filename,
      filters: [{ name: 'Markdown', extensions: ['md'] }] });
    return result.canceled || !result.filePath ? null : result.filePath;
  } });
  ipcMain.handle('polyask:markdown-preview', (event, input: unknown) => {
    if (!options.trusted(event)) throw new Error('untrusted_sender');
    try { return service.preview(parseMarkdownPreview(input)); }
    catch (error) {
      const message = error instanceof Error ? error.message : '';
      throw new Error(message === 'invalid_request' || MARKDOWN_EXPORT_CODES.some(code => code === message) ? message : 'markdown_failed');
    }
  });
  ipcMain.handle('polyask:markdown-export', (event, input: unknown) => {
    if (!options.trusted(event)) throw new Error('untrusted_sender');
    return service.export(parseMarkdownExport(input));
  });
  return () => { service.dispose(); ipcMain.removeHandler('polyask:markdown-preview'); ipcMain.removeHandler('polyask:markdown-export'); };
}
