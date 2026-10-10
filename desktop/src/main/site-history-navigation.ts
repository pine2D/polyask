import type { WebContentsView } from 'electron';
import type { SiteHistoryState, SiteStatus } from '../shared/protocol';
import { siteReloadAllowed } from '../shared/site-health';

export function siteHistoryState(view: WebContentsView | undefined, phase: SiteStatus['phase'], navigating: boolean): SiteHistoryState {
  // 群发/生成进行中不许动历史，理由同 reload：会把正在写的回答连同页面一起丢掉。
  if (!view || view.webContents.isDestroyed() || !siteReloadAllowed(phase) || navigating) return { back: false, forward: false };
  const history = view.webContents.navigationHistory;
  return { back: history.canGoBack(), forward: history.canGoForward() };
}

export function navigateSiteHistory(view: WebContentsView | undefined, state: SiteHistoryState, offset: -1 | 1, before: () => void): boolean {
  if (!view || !(offset === -1 ? state.back : state.forward)) return false;
  before();
  if (offset === -1) view.webContents.navigationHistory.goBack();
  else view.webContents.navigationHistory.goForward();
  return true;
}
