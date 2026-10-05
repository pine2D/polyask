// 「新会话 / 历史恢复」只需要知道主帧已经提交到目标页，不需要等整页 did-finish-load：
// webContents.loadURL() 的 promise 要等 did-finish-load 才 resolve，慢站实测 23–48s，Claude 卡在
// 等响应时可以无限期不落地；而这段时间调用方一直占着 OperationGate，群发只能拿到 operation_busy。
// 提交（did-navigate）之后站点 preload 已注入，群发自己会在 deadline 内对 not_ready/composer_not_found
// 重试，所以把等待点前移到提交不会让群发打进旧文档。需要整页就绪的调用方（辅助综合：导航后立刻发送）
// 继续用 "load"。
export type NavigationWait = "load" | "commit";

export interface CommitContents {
  loadURL(url: string): Promise<void>;
  on(event: string, listener: (...args: any[]) => void): unknown;
  removeListener(event: string, listener: (...args: any[]) => void): unknown;
}

export function loadUntil(contents: CommitContents, url: string, until: NavigationWait): Promise<void> {
  if (until === "load") return contents.loadURL(url);
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const settle = (error?: unknown) => {
      if (settled) return;
      settled = true;
      contents.removeListener("did-navigate", onCommit);
      contents.removeListener("did-fail-load", onFail);
      contents.removeListener("destroyed", onGone);
      if (error === undefined) resolve();
      else reject(error instanceof Error ? error : new Error("load_failed"));
    };
    // did-navigate 只在主帧跨文档提交时发（页内导航走 did-navigate-in-page），监听在 loadURL 之前挂上。
    const onCommit = () => settle();
    // ERR_ABORTED(-3) 不算失败：旧文档还没 did-finish-load 时，新导航提交前一刻会先为旧文档发一次主帧 -3
    // （2026-10-04 Linux 真机：ChatGPT 上一轮仍在加载，-3 后 16ms 即 did-navigate，旧写法把成功的新会话报成 not_ready）。
    // 本次导航真被取代或 stop() 时不会再提交，由调用方的硬上限收口（见下）。
    const onFail = (_event: unknown, code: number, _description: string, _url: string, isMainFrame: boolean) => {
      if (isMainFrame && code !== -3) settle(new Error("load_failed"));
    };
    const onGone = () => settle(new Error("view_destroyed"));
    contents.on("did-navigate", onCommit);
    contents.on("did-fail-load", onFail);
    contents.on("destroyed", onGone);
    // loadURL 的结局不认身份：旧文档还在加载时，它的 did-finish-load / -3 会让新的 loadURL 提前 resolve 或 reject
    // （2026-10-04 Linux 真机：元宝旧文档 1654ms 落地，loadURL 随之 resolve，新导航 2933ms 才提交）。所以在提交模式下
    // resolve 与 ERR_ABORTED 都不算数，只认 did-navigate；真被取代或 stop() 的导航不会再提交，由调用方的硬上限
    // （新会话、历史恢复都是单站 20s）收口。其余 reject（被拦等）照常作为失败上报；提交后的 reject 已 settle，吞掉即可。
    try {
      contents.loadURL(url).then(() => undefined, (error: unknown) => {
        if (!aborted(error)) settle(error ?? new Error("load_failed"));
      });
    } catch (error) { settle(error ?? new Error("load_failed")); }
  });
}

function aborted(error: unknown): boolean {
  const value = error as { code?: unknown; errno?: unknown } | null;
  return !!value && (value.errno === -3 || value.code === "ERR_ABORTED");
}
