import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import type { SitePageService } from './site-page-service';

export interface SitePageIpcOptions {
  readonly service: Pick<SitePageService, 'preview' | 'close'>;
  readonly trusted: (event: IpcMainInvokeEvent) => boolean;
}

export function registerSitePageIpc(options: SitePageIpcOptions): () => void {
  ipcMain.handle('polyask:preview-site-page-close', (event, site: unknown) => {
    if (!options.trusted(event)) throw new Error('untrusted_sender');
    return options.service.preview(site);
  });
  ipcMain.handle('polyask:close-site-page', (event, request: unknown) => {
    if (!options.trusted(event)) throw new Error('untrusted_sender');
    return options.service.close(request);
  });
  return () => {
    ipcMain.removeHandler('polyask:preview-site-page-close');
    ipcMain.removeHandler('polyask:close-site-page');
  };
}
