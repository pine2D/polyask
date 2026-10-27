import { SITE_KEYS, type SiteKey } from '../shared/contracts';
import { parsePageIndex } from '../shared/protocol';
import type { ViewManager } from './view-manager';

interface NavigationIpc {
  on(channel: string, listener: (event: any, value?: unknown) => void): unknown;
  handle(channel: string, listener: (event: any) => unknown): void;
  removeAllListeners(channel: string): unknown;
  removeHandler(channel: string): void;
}

/** 页面与站点焦点操作共用外壳信任检查，聚焦不修改站点布局。 */
export function registerWorkbenchNavigationIpc(ipcMain: NavigationIpc, manager: ViewManager,
  trustedShell: (event: any) => boolean, saveLayout: (mode: 'overview' | 'focus') => void = () => {}): () => void {
  ipcMain.on("polyask:set-layout", (event, value: unknown) => {
    if (!trustedShell(event) || !value || typeof value !== "object") return;
    const candidate = value as { mode?: unknown; focused?: unknown };
    if (candidate.mode !== "overview" && candidate.mode !== "focus") return;
    if (typeof candidate.focused !== "string" || !SITE_KEYS.includes(candidate.focused as SiteKey)) return;
    if (manager.setLayout(candidate.mode, candidate.focused as SiteKey)) saveLayout(candidate.mode);
  });
  ipcMain.on("polyask:set-page", (event, value: unknown) => {
    if (!trustedShell(event)) return;
    const page = parsePageIndex(value);
    if (page !== null) manager.setPage(page);
  });
  // 相对翻页/换焦点只认 ViewManager 的当前页与聚焦顺序——渲染层自己算会与主进程漂开。
  const step = (value: unknown): -1 | 1 | null => (value === 1 ? 1 : value === -1 ? -1 : null);
  ipcMain.on("polyask:step-page", (event, value: unknown) => {
    if (!trustedShell(event)) return;
    const offset = step(value);
    if (offset) manager.pageRelative(offset);
  });
  ipcMain.on("polyask:step-site", (event, value: unknown) => {
    if (!trustedShell(event)) return;
    const offset = step(value);
    if (offset) manager.focusRelative(offset);
  });
  // 站内后退/前进：作用于当前聚焦的站点视图，能不能退由 ViewManager 按真实导航历史判定。
  ipcMain.on("polyask:step-history", (event, value: unknown) => {
    if (!trustedShell(event)) return;
    const candidate = value as { site?: unknown; offset?: unknown } | null;
    const offset = step(candidate?.offset);
    const site = typeof candidate?.site === "string" && SITE_KEYS.includes(candidate.site as SiteKey)
      ? candidate.site as SiteKey
      : manager.getLayout().focused;
    if (offset) manager.navigateHistory(site, offset);
  });
  ipcMain.handle("polyask:site-history-state", (event) =>
    trustedShell(event) ? manager.historyState() : {});
  ipcMain.on('polyask:focus-current-site', event => {
    if (trustedShell(event)) manager.focusCurrentSite();
  });
  return () => {
    for (const channel of ['set-layout', 'set-page', 'step-page', 'step-site', 'step-history', 'focus-current-site'])
      ipcMain.removeAllListeners('polyask:' + channel);
    ipcMain.removeHandler('polyask:site-history-state');
  };
}
