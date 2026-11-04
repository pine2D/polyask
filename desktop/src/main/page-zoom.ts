import type { IpcMain, IpcMainInvokeEvent, WebContents } from 'electron';
import { siteZoomAction, stepSiteZoom, type SiteZoomAction } from '../shared/site-zoom';

export type PageZoomContents = Pick<WebContents, 'isDestroyed' | 'getZoomFactor' | 'setZoomFactor' | 'send'>;

/** 外壳菜单、快捷键、滚轮与阅读页按钮共用同一比例和浏览器档位。 */
export function changePageZoom(contents: PageZoomContents, action: SiteZoomAction, relayout: () => void): number {
  const zoom = stepSiteZoom(contents.getZoomFactor(), action);
  contents.setZoomFactor(zoom);
  relayout();
  const actual = contents.getZoomFactor();
  contents.send('polyask:page-zoom-changed', actual);
  return actual;
}

export function registerPageZoomIpc(ipc: Pick<IpcMain, 'handle' | 'removeHandler'>, contents: WebContents,
  trusted: (event: IpcMainInvokeEvent) => boolean, relayout: () => void): () => void {
  const previousMode = contents.getZoomMode();
  // 与站点视图同样隔离缩放；比例由本窗口处理，不传播给其它 WebContents。
  contents.setZoomMode('isolated');
  const change = (action: SiteZoomAction) => changePageZoom(contents, action, relayout);
  const wheel = (_event: Electron.Event, direction: 'in' | 'out') => { change(direction); };
  const key = (event: Electron.Event, input: Electron.Input) => {
    const action = siteZoomAction(input, process.platform);
    if (!action) return;
    event.preventDefault(); // 阻止同一次按键再次触发菜单加速器。
    change(action);
  };
  contents.on('zoom-changed', wheel);
  contents.on('before-input-event', key);
  ipc.handle('polyask:page-zoom-get', event => {
    if (!trusted(event)) throw Error('untrusted_sender');
    return contents.getZoomFactor();
  });
  ipc.handle('polyask:page-zoom-change', (event, action: unknown) => {
    if (!trusted(event)) throw Error('untrusted_sender');
    if (action !== 'in' && action !== 'out' && action !== 'reset') throw Error('invalid_zoom_action');
    return change(action);
  });
  return () => {
    ipc.removeHandler('polyask:page-zoom-get');
    ipc.removeHandler('polyask:page-zoom-change');
    contents.removeListener('zoom-changed', wheel);
    contents.removeListener('before-input-event', key);
    if (!contents.isDestroyed()) contents.setZoomMode(previousMode);
  };
}
