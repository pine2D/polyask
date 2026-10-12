import { join } from "node:path";

import { app, safeStorage, session, webContents } from "electron";

import type { DesktopDatabase } from "./database";
import { ProxyAuth } from "./proxy-auth";
import { ProxyPreferenceStore } from "./proxy-preference-store";
import { linuxDesktopProxySource, ProxyRuntime } from "./proxy-runtime";
import { managedSessions, SITE_PARTITION, verifySessions } from "./proxy-sessions";
import { safeEncryptionAvailability, SecretFileStore, type TokenCrypto } from "./secret-file-store";

export const PROXY_SECRET_FILE = "proxy-secret.bin";

export interface ProxyServices {
  readonly runtime: ProxyRuntime;
  readonly auth: ProxyAuth;
  readonly store: ProxyPreferenceStore;
  readonly secrets: SecretFileStore;
}

/**
 * 代理密码的加密后端。可用性单独判断（spec §4.4）：不能复用 sync-runtime 里依赖 OAuth 凭据的 encryptionAvailable。
 * 是否算「安全落盘」（排除 basic_text / unknown / unavailable）由 SecretFileStore.securePersistence 判定。
 */
export function proxySecretCrypto(platform: NodeJS.Platform = process.platform): TokenCrypto {
  return {
    backend: () => platform === "linux" ? safeStorage.getSelectedStorageBackend() : "os_crypt",
    available: () => safeEncryptionAvailability(() => safeStorage.isAsyncEncryptionAvailable()),
    encrypt: (value) => safeStorage.encryptStringAsync(value),
    decrypt: async (value) => (await safeStorage.decryptStringAsync(value)).result
  };
}

/**
 * 每个进程只装配一次（whenReady 里、数据库就绪之后）：macOS activate 会重跑 createWindow，
 * 但 app 'login' 监听与密码缓存不能随窗口重建而重复。启动时不读密码（spec §3.3），首个 407 才惰性读（§3.6）。
 */
export function createProxyServices(database: DesktopDatabase): ProxyServices {
  const secrets = new SecretFileStore(join(app.getPath("userData"), PROXY_SECRET_FILE), proxySecretCrypto(),
    { invalidCode: "proxy_invalid" });
  const auth = new ProxyAuth({ store: secrets });
  const store = new ProxyPreferenceStore(database);
  const siteSession = () => session.fromPartition(SITE_PARTITION);
  const runtime = new ProxyRuntime({
    sessions: managedSessions,
    // 校验只看站点与 polyask-net（spec §3.2 第 3 步）；defaultSession 与 app.setProxy 只应用不校验。
    verifySessions,
    app, auth, store,
    // 与 ProxyAuth 共用同一份 proxy-secret.bin：本机重置的 wipeSecrets 经它删文件（spec §4.6）。
    secrets,
    // WebRTC 策略只作用于站点视图；外壳窗口在 defaultSession，不参与（spec §3.2「WebRTC 策略」）。
    webContents: () => webContents.getAllWebContents()
      .filter((contents) => !contents.isDestroyed() && contents.session === siteSession()),
    // 加密可用性不经 runtime：只由 auth.securePersistence() 读取（preflight R4）。
    environment: {
      // 启动环境决定 Chromium 在 Linux 上读桌面设置还是 *_proxy 环境变量；进程内不变，装配时算一次（spec §6.2）。
      linuxDesktopProxy: linuxDesktopProxySource(process.platform, process.env)
    }
  });
  // 站点视图及其 Service Worker 的 407（spec §3.6）；polyask-net 走请求级 login，
  // 由 window-data-services 经 T10 的 onProxyLogin 接到 auth.handleRequestLogin。
  app.on("login", (event, contents, details, authInfo, callback) =>
    auth.handleAppLogin(event, contents, details, authInfo, callback));
  return { runtime, auth, store, secrets };
}
