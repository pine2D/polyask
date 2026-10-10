import type { WebContentsView } from 'electron';
import type { SiteHistoryState, SiteStatus } from '../shared/protocol';
import { siteReloadAllowed } from '../shared/site-health';
import { allowAppNavigationUnload } from './app-navigation-unload';
import { RELOAD_COMMIT_CAP_MS } from './reload-commit';

type HistoryContents = WebContentsView['webContents'];

export function siteHistoryState(view: WebContentsView | undefined, phase: SiteStatus['phase'], navigating: boolean): SiteHistoryState {
  // 群发/生成进行中不许动历史，理由同 reload：会把正在写的回答连同页面一起丢掉。
  if (!view || view.webContents.isDestroyed() || !siteReloadAllowed(phase) || navigating) return { back: false, forward: false };
  const history = view.webContents.navigationHistory;
  return { back: history.canGoBack(), forward: history.canGoForward() };
}

export interface HistoryStepHooks {
  /** 发起前：清运行态、置 loading，并给跨文档提交挂上限（target = 目标历史条目地址）。 */
  readonly begin: (contents: HistoryContents, target: string | undefined) => void;
  /** 结果是同文档导航（SPA 历史条目）：不会有 did-navigate / did-finish-load，须撤掉上限并恢复原页面阶段。 */
  readonly sameDocument: () => void;
}

export function navigateSiteHistory(view: WebContentsView | undefined, state: SiteHistoryState, offset: -1 | 1, hooks: HistoryStepHooks): boolean {
  if (!view || !(offset === -1 ? state.back : state.forward)) return false;
  const contents = view.webContents;
  const history = contents.navigationHistory;
  const target = history.getEntryAtIndex(history.getActiveIndex() + offset)?.url;
  hooks.begin(contents, target);
  allowAppNavigationUnload(contents);
  watchSameDocumentStep(contents, hooks.sameDocument);
  if (offset === -1) history.goBack();
  else history.goForward();
  return true;
}

type StepEvents = Pick<HistoryContents, 'isDestroyed'> & {
  on(event: string, listener: (...args: any[]) => void): unknown;
  removeListener(event: string, listener: (...args: any[]) => void): unknown;
};

const steps = new WeakMap<object, () => void>();

// 后退/前进落到同文档条目时只发 did-start-navigation(isSameDocument) + did-navigate-in-page，PageLifecycle 不会
// 给出 ready（它只认跨文档主帧），旧写法于是永久停在 loading。主帧跨文档开始则交给 PageLifecycle 与提交上限。
export function watchSameDocumentStep(contents: StepEvents, onSameDocument: () => void, capMs = RELOAD_COMMIT_CAP_MS): void {
  steps.get(contents)?.();
  if (contents.isDestroyed()) return;
  const onInPage = (_event: unknown, _url: string, isMainFrame: boolean) => {
    if (!isMainFrame) return;
    clear();
    onSameDocument();
  };
  const onStart = (details: { isMainFrame?: boolean; isSameDocument?: boolean }) => {
    if (details?.isMainFrame && !details.isSameDocument) clear();
  };
  const timer = setTimeout(() => clear(), capMs);
  const clear = () => {
    clearTimeout(timer);
    contents.removeListener('did-navigate-in-page', onInPage);
    contents.removeListener('did-start-navigation', onStart);
    contents.removeListener('destroyed', clear);
    if (steps.get(contents) === clear) steps.delete(contents);
  };
  contents.on('did-navigate-in-page', onInPage);
  contents.on('did-start-navigation', onStart);
  contents.on('destroyed', clear);
  steps.set(contents, clear);
}
