import type { BrowserWindow, WebContentsView } from 'electron';
export { historyPanelWidth } from '../shared/question-layout';
/** Keep native pages attached with their positive bounds while the shell covers them. */
export function raiseHistoryShell(window: BrowserWindow): void {
  const shell = window.contentView.children.find(view => (view as WebContentsView).webContents === window.webContents);
  if (shell) window.contentView.addChildView(shell);
}
