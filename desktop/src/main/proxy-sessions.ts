// desktop/src/main/proxy-sessions.ts
// 代理受管出口的唯一清单（spec §3.1）。站点 partition 沿用 diagnostics 的常量；
// Drive/OAuth 用非持久的 polyask-net，测试连接用独立的 polyask-proxy-probe（不在受管清单里，每次测试单独配置）。
import { session } from "electron";

import { SITE_PARTITION } from "./diagnostics";

export { SITE_PARTITION };
/** In-memory session for Drive and OAuth (no "persist:" prefix): sync payloads and Google cookies never reach a disk cache. */
export const NET_PARTITION = "polyask-net";
/** 测试连接专用出口：非持久，不受全局代理影响。 */
export const PROBE_PARTITION = "polyask-proxy-probe";

/** setProxy / clearAuthCache 的受管出口：站点 partition、defaultSession（Shell 与开发态 dev server）、polyask-net。须在 app ready 之后调用。 */
export function managedSessions(): Electron.Session[] {
  return [session.fromPartition(SITE_PARTITION), session.defaultSession, session.fromPartition(NET_PARTITION)];
}

/** 应用后用 resolveProxy(PROXY_CHECK_URL) 校验的出口：站点 partition 与 polyask-net（§3.2 第 3 步）。 */
export function verifySessions(): Electron.Session[] {
  return [session.fromPartition(SITE_PARTITION), session.fromPartition(NET_PARTITION)];
}
