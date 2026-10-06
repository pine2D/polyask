import type { SiteKey } from "../shared/contracts";

// 重载（「重新加载」与「清缓存重载」）等主帧提交的硬上限。reload() 发出后主帧文档请求一直不回包时，
// Electron 不会报 did-fail-load，PageLifecycle 便一直停在 loading：Windows 真机 Claude 在 isLoading &&
// isWaitingForResponse 上挂了 11 分钟以上，用户除了再点重载（照样挂住）没有出路。
// 取值：Windows 真机后台页重载 5 次，reload→did-navigate 为 104–1776ms（最慢 Gemini）；同机新会话导航
// 18 次最慢 3557ms（锁屏下的 Gemini）；2026-10-05 第 6 轮网络变慢时 ChatGPT 带 Cookie 的 HTML 约 13s 才回。
// 原取 15s，对 13s 不足 20% 余量；现取 20s（约 1.5 倍），与新会话、历史恢复的单站上限一致：多等几秒的代价只是
// 多看一会儿 loading，误判的代价是把一个慢但能落地的页面中止掉。视图首次加载（createView）也走这只看门。
// 到点经 abandon（SiteHistoryAccess.abandon：stop() + 钉成 load_failed；旧文档就是重载目标页时保留并恢复就绪）收口，绝不留在 loading。
export const RELOAD_COMMIT_CAP_MS = 20_000;

export interface ReloadContents {
  readonly id: number;
  readonly mainFrame?: { readonly url?: string };
  isDestroyed(): boolean;
  on(event: string, listener: (...args: any[]) => void): unknown;
  removeListener(event: string, listener: (...args: any[]) => void): unknown;
}

export class ReloadCommitWatch {
  private readonly pending = new Map<SiteKey, () => void>();

  constructor(private readonly abandon: (site: SiteKey, contentsId: number, target?: string) => void,
    private readonly capMs = RELOAD_COMMIT_CAP_MS) {}

  // 视图管理器发起的每次导航都先替换掉上一次重载的看门：新导航（后退/前进、新会话、历史恢复）有自己的上限，
  // 旧计时器不能把一个正在正常提交的新导航中止掉。传 contents = 本次是重载，须在 reload()/reloadIgnoringCache()
  // 之前挂上。解除条件：主帧跨文档提交（did-navigate；页内导航走 did-navigate-in-page，不算）、主帧真失败
  // （非 ERR_ABORTED：PageLifecycle 已钉成 failed）、渲染进程退出（已钉成 crashed，到点的 abandon 会把崩溃原因
  // 改写成 load_failed）、视图销毁、或下一次 replace。
  // 提交之后 did-finish-load 迟迟不来不归这里管，那是渲染/节流问题。
  // target 默认取挂门时已提交的地址（重载就是重新请求它）；首次加载由调用方传入要加载的地址。
  replace(site: SiteKey, contents?: ReloadContents, target = contents?.mainFrame?.url): void {
    this.pending.get(site)?.();
    if (!contents) return;
    const onCommit = () => clear();
    const onFail = (_event: unknown, code: number, _description: string, _url: string, isMainFrame: boolean) => {
      if (isMainFrame && code !== -3) clear();
    };
    const timer = setTimeout(() => {
      clear();
      if (!contents.isDestroyed()) this.abandon(site, contents.id, target);
    }, this.capMs);
    const clear = () => {
      clearTimeout(timer);
      contents.removeListener("did-navigate", onCommit);
      contents.removeListener("did-fail-load", onFail);
      contents.removeListener("destroyed", onCommit);
      contents.removeListener("render-process-gone", onCommit);
      if (this.pending.get(site) === clear) this.pending.delete(site);
    };
    contents.on("did-navigate", onCommit);
    contents.on("did-fail-load", onFail);
    contents.on("destroyed", onCommit);
    contents.on("render-process-gone", onCommit);
    this.pending.set(site, clear);
  }

  // 看门期间 sendCommand / collect 报可重试的 not_ready：旧文档马上会被替换（提交）或被中止并钉成 load_failed（到点），
  // 打进去的提示要么提交中途丢文档（submit_unconfirmed），要么被到点的 load_failed 盖住、生成态一并作废。
  // 群发在 deadline 内照常重试，直到重载提交或到点收口。
  watching(site: SiteKey): boolean {
    return this.pending.has(site);
  }
}
