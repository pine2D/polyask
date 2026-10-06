import type { WebContents, WebContentsView } from "electron";
import type { SiteKey } from "../shared/contracts";
import { normalizeHistorySnapshot } from "../shared/question-capture";
import { loadUntil, type NavigationWait } from "./navigation-commit";
import { ReloadCommitWatch } from "./reload-commit";
import { safeQuestionUrl } from "./question-navigation";
import type { SiteCommandChannel } from "./site-command-channel";
import { SITES } from "./sites";

// 中止的导航若就是要去旧文档自己的地址（重载同一页、本就停在新会话页又点新会话），旧文档就是目标页本身：
// 保留它、恢复就绪，而不是钉 load_failed——2026-10-06 Windows：claude.ai 带 Cookie 的 HTML 一直不回包，
// 每次新会话/重载 20s 后都钉失败，可屏幕上那份 /new 页面完好可用，Claude 从此发不出去。只认「已提交地址 ===
// 目标地址」、https、且主帧 origin 与地址一致（错误页 origin 不透明）；地址不同（旧会话、恢复、首次加载）照旧钉失败，
// 否则群发会打进旧会话。lastCommittedURL 含 pushState，所以已开始的会话（/chat/<id>）不会被当成新会话页。
export function keepsOldDocument(contents: unknown, target?: string): boolean {
  const frame = (contents as { mainFrame?: { url?: string; origin?: string } }).mainFrame;
  const url = frame?.url ?? "";
  if (!target || url !== target || !url.startsWith("https://")) return false;
  try { return frame?.origin === new URL(url).origin; } catch { return false; }
}

export class SiteHistoryAccess {
  panelOpen = false;
  // 重载等提交的看门（上限与取值见 reload-commit.ts）；到点与新会话超时同走 abandon 收口。
  readonly reloads = new ReloadCommitWatch((site, contentsId, target) => this.abandon(site, contentsId, target));
  // 等主帧提交中的新会话 / 历史恢复（commit 模式）。这期间视图管理器拒绝重载、后退/前进与清站点数据：Chromium 的
  // reload() 会丢掉未提交的 loadURL、重载旧会话，它的 did-navigate 又会被 loadUntil 当成本次提交，新会话报成功、
  // 群发却打进旧会话。解除：提交/失败（loadUntil 结束）、或调用方到上限时的 abandon()（新会话、历史恢复的超时与取消，均为单站 20s）/ stop()。
  private readonly committing = new Map<SiteKey, object>();
  navigating(site: SiteKey): boolean { return this.committing.has(site); }
  setPanelOpen(value: boolean): void { this.panelOpen = value; this.relayout(); }
  constructor(private readonly view: (site: SiteKey) => WebContentsView | undefined,
    private readonly commands: SiteCommandChannel,
    private readonly beforeNavigate: (site: SiteKey, abandoned?: "failed" | "ready") => void, private readonly relayout: () => void = () => {}) {}
  context(site: SiteKey): { id: number; url: string } | null {
    const contents = this.view(site)?.webContents;
    return contents && !contents.isDestroyed() ? { id: contents.id, url: contents.getURL() } : null;
  }
  stop(site: SiteKey, contentsId?: number): void {
    const contents = this.view(site)?.webContents;
    if (contents && !contents.isDestroyed() && (contentsId === undefined || contents.id === contentsId)) { this.committing.delete(site); contents.stop(); }
  }
  // 新会话等提交超时：中止仍未提交的导航，并把该站钉成 load_failed。stop() 只产生 ERR_ABORTED（PageLifecycle 视为
  // 正常、不改阶段），不显式收口的话旧文档留在 loading 里、sendCommand 照常把群发打进旧会话。用户点重载即恢复。
  // target = 这次导航要去的地址；旧文档恰好就是它时保留并恢复就绪（见 keepsOldDocument）。
  abandon(site: SiteKey, contentsId: number, target?: string): void {
    const contents = this.view(site)?.webContents;
    if (!contents || contents.isDestroyed() || contents.id !== contentsId) return;
    const keep = keepsOldDocument(contents, target);
    this.committing.delete(site);
    contents.stop();
    this.beforeNavigate(site, keep ? "ready" : "failed");
  }
  // 视图首次加载（启动、重选后重建、replaceView）同样挂重载看门：主帧文档请求一直不回包时 Electron 不报
  // did-fail-load，PageLifecycle 会无限停在 loading，用户看不到重载入口（2026-10-05 Windows 第 6 轮，Claude 重建视图
  // 停在 loading 12 分钟以上）。到点 abandon 钉 load_failed；看门须在 loadURL 之前挂上。
  initialLoad(site: SiteKey, contents: WebContents, url: string): void {
    this.reloads.replace(site, contents, url);
    void contents.loadURL(url);
  }
  async snapshot(site: SiteKey, token: string, deadline: number) {
    const contents = this.view(site)?.webContents;
    if (!contents || contents.isDestroyed()) return { token, owned: false, ended: true };
    const response = await this.commands.send(contents, { source: "AMS", cmd: "historySnapshot", token, deadline },
      { timeoutResult: { token, owned: false } });
    if (this.view(site)?.webContents !== contents || contents.isDestroyed()) return { token, owned: false, ended: true };
    const result = normalizeHistorySnapshot(response, token);
    // The untrusted page cannot supply a different navigation target.
    return { ...result, url: result.owned ? safeQuestionUrl(site, contents.getURL()) : null };
  }
  // 默认只等主帧提交（历史恢复、新会话都在 OperationGate 里，等 did-finish-load 会把门占住几十秒）；
  // 辅助综合导航后立刻发送，显式要 "load"。
  async navigate(site: SiteKey, url: string, homepage = false, until: NavigationWait = "commit"): Promise<void> {
    const definition = SITES.find(item => item.key === site);
    const contents = this.view(site)?.webContents;
    if (!contents || contents.isDestroyed() || (homepage ? definition?.url !== url : safeQuestionUrl(site, url) !== url)) throw new Error("invalid_navigation");
    if (!homepage && contents.getURL() === url) return;
    this.reloads.replace(site);
    this.beforeNavigate(site);
    if (until !== "commit") { await loadUntil(contents, url, until); return; }
    const token = {};
    this.committing.set(site, token);
    try { await loadUntil(contents, url, until); } finally { if (this.committing.get(site) === token) this.committing.delete(site); }
  }
}
