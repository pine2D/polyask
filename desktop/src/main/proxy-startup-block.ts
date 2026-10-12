// desktop/src/main/proxy-startup-block.ts
// 启动阻断（spec §3.3 fail-closed）：app ready 之前给所有网络上下文一个必然失败的默认代理。
// 只要 session 被实例化，Chromium 就会立刻下载拼写词典（redirector.gvt1.com），这一步不等 webContents，
// webPreferences.spellcheck=false 也挡不住。外壳窗口与 applyConfig 第 1 步的 clearAuthCache 都会在
// 首次 setProxy 之前实例化受管 session，所以没有这个开关时，存了自定义代理的启动也会先直连出网。
// Electron 44.5.0 实测：session.setProxy / app.setProxy 的 fixed_servers（http、socks5）、direct、system
// 都能覆盖它（system 仍按系统/环境变量代理走）；回环地址照常隐式直连，开发态 dev server 不受影响。
import type { CommandLine } from "electron";

import { BLOCKING_PROXY_RULES } from "../shared/proxy-preference";

/** 必须在 app ready 之前、模块顶层调用。 */
export function blockProxyUntilApplied(commandLine: Pick<CommandLine, "appendSwitch">): void {
  commandLine.appendSwitch("proxy-server", BLOCKING_PROXY_RULES);
}
