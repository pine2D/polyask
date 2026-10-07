import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import { SITE_KEYS, type SiteKey } from '../shared/contracts';
import type { ViewManager } from './view-manager';

/** 同一个主进程事件内核对选择与定位，回执不能被 renderer 的旧选择快照替代。 */
export function registerSiteInspectionIpc(options: {
  manager: Pick<ViewManager, 'setLayout' | 'setSurface'>;
  trusted: (event: IpcMainInvokeEvent) => boolean;
}): () => void {
  ipcMain.handle('polyask:inspect-site', (event, value: unknown) => {
    if (!options.trusted(event)) throw Error('untrusted_sender');
    if (typeof value !== 'string' || !SITE_KEYS.includes(value as SiteKey)) throw Error('invalid_site');
    if (options.manager.setLayout('focus', value as SiteKey) !== true) return false;
    options.manager.setSurface('sites');
    return true;
  });
  return () => ipcMain.removeHandler('polyask:inspect-site');
}
