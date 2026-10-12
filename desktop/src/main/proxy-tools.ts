import { session } from "electron";

import type { SiteKey } from "../shared/contracts";
import { toProxyConfig } from "../shared/proxy-preference";
import { createSessionFetch } from "./net-request-fetch";
import { ProxyProbe, storedPasswordReader } from "./proxy-probe";
import { reloadAllSites, type SiteReloader } from "./proxy-reload";
import { PROBE_PARTITION, SITE_PARTITION } from "./proxy-sessions";
import type { ProxyServices } from "./proxy-services";

// 设置卡「测试连接」与「重新加载全部站点」的生产装配（spec §6.3、§3.4）。每个窗口建一次：
// reloadSites 要用这个窗口的 ViewManager，而 createProxyServices 每进程只跑一次、那时还没有窗口。
// index.ts 把结果并进 registerShellIpc 的 proxy 选项，T14 的 registerProxyIpc 见到它们才注册两个通道。

export interface ProxyTools {
  readonly probe: ProxyProbe;
  readonly reloadSites: () => Promise<{ skipped: SiteKey[] }>;
}

export function createProxyTools(
  proxy: Pick<ProxyServices, "auth" | "secrets">,
  manager: SiteReloader,
  sites: () => readonly SiteKey[]
): ProxyTools {
  const probe = new ProxyProbe({
    // 独立的内存 partition：测试的 setProxy、认证缓存与连接池都不碰站点、Drive 与外壳。
    session: () => session.fromPartition(PROBE_PARTITION),
    // 不传 request：生产走 electron net.request；onLogin 是 probe 每次测试自建的请求级 login。
    fetchFor: (target, onLogin) => createSessionFetch(target, { onLogin }),
    translate: toProxyConfig,
    storedPassword: storedPasswordReader(proxy.secrets, proxy.auth)
  });
  return {
    probe,
    reloadSites: () => reloadAllSites(manager, session.fromPartition(SITE_PARTITION), sites())
  };
}
