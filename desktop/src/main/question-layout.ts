import type { BrowserWindow, WebContentsView } from 'electron';
export { historyPanelWidth } from '../shared/question-layout';
/** BrowserWindow's shell is not a reorderable child. Hide native site views in place:
 * Electron 43 keeps their positive viewports and visibilityState with throttling disabled.
 * Detaching them would instead reduce the web page viewport to zero. */
export function coverSitesForHistory(window: BrowserWindow, covered: boolean): void {
  for (const view of window.contentView.children) {
    if ((view as WebContentsView).webContents !== window.webContents) view.setVisible(!covered);
  }
}
