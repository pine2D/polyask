import type { Session } from "electron";

import type { SiteKey } from "../shared/contracts";

// 「重新加载全部站点」（spec §3.4，polyask:proxy-reload-sites）：先关掉站点 partition 的池化连接，
// 再逐个已选站点 reload，让每个站点都按新代理重新建连。由 proxy-ipc 在 OperationGate 内调用。

const CLOSE_TIMEOUT_MS = 5_000;

/** ViewManager 的结构子集；reload 返回 false（页面在发送/生成中、正在导航、视图已销毁）的站点交给用户手动刷新。 */
export interface SiteReloader {
  reload(site: SiteKey, ignoreCache?: boolean): boolean;
}

export async function reloadAllSites(
  manager: SiteReloader,
  siteSession: Pick<Session, "closeAllConnections">,
  sites: readonly SiteKey[],
  closeTimeoutMs = CLOSE_TIMEOUT_MS
): Promise<{ skipped: SiteKey[] }> {
  // 关闭失败或超时直接抛给调用方：没关掉旧连接时 reload 可能沿旧线路，不能报告成已切换。
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      siteSession.closeAllConnections(),
      new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error("timed_out")), closeTimeoutMs); })
    ]);
  } finally {
    clearTimeout(timer);
  }
  const skipped: SiteKey[] = [];
  // 只遍历已选站点：未选站点没有视图，会被误列为「请手动刷新」。
  for (const site of sites) {
    let reloaded = false;
    try {
      reloaded = manager.reload(site);
    } catch {
      reloaded = false;
    }
    if (!reloaded) skipped.push(site);
  }
  return { skipped };
}
