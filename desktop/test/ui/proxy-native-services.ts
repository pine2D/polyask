// 原生代理检查的主进程入口：只转导出生产模块与 T1 本地代理夹具，由 webpack 打成 electron-main CJS。
// 不在这里写任何逻辑：场景要验证的是生产装配本身。
export { DesktopDatabase } from "../../src/main/database";
export { SyncRepository } from "../../src/main/sync-repository";
export { createProxyServices } from "../../src/main/proxy-services";
export { ProxyPreferenceStore } from "../../src/main/proxy-preference-store";
export { registerProxyIpc } from "../../src/main/proxy-ipc";
export { ProxyProbe } from "../../src/main/proxy-probe";
export { createSessionFetch } from "../../src/main/net-request-fetch";
export { NET_PARTITION, PROBE_PARTITION, SITE_PARTITION } from "../../src/main/proxy-sessions";
export { classifyNetError } from "../../src/main/proxy-errors";
export { toProxyConfig } from "../../src/shared/proxy-preference";
export { OperationGate } from "../../src/shared/operation-gate";
export { ipcErrorCode } from "../../src/shared/ipc-error";
export { startHttpProxy, startOrigin, startSocksProxy } from "../support/local-proxy";
