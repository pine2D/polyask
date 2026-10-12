import { join } from "node:path";

import { app, safeStorage, session as electronSession, shell as electronShell } from "electron";

import type { SyncStatus } from "../shared/sync";
import type { WorkspaceState } from "../shared/workspace";
import type { DesktopDatabase } from "./database";
import { DriveClient } from "./drive-client";
import { createSessionFetch } from "./net-request-fetch";
import { loadOAuthClientCredentials } from "./oauth-pkce";
import { OAuthSession } from "./oauth-session";
import { NET_PARTITION } from "./proxy-sessions";
import { SyncEngine } from "./sync-engine";
import { SyncRepository } from "./sync-repository";
import { safeEncryptionAvailability, TokenStore } from "./token-store";

/** Request-level proxy `login` for Drive/OAuth requests (ProxyAuth.handleRequestLogin); omitted = the adapter cancels. */
export type ProxyLoginHandler = NonNullable<NonNullable<Parameters<typeof createSessionFetch>[1]>["onLogin"]>;

interface SyncRuntimeOptions {
  readonly database: DesktopDatabase;
  readonly workspace: () => WorkspaceState;
  readonly onStatus: (status: SyncStatus) => void;
  readonly onWorkspace: (workspace: WorkspaceState) => void;
  readonly onProxyLogin?: ProxyLoginHandler;
}

export async function createSyncRuntime(options: SyncRuntimeOptions): Promise<SyncEngine> {
  const credentials = await loadOAuthClientCredentials({
    environment: app.isPackaged ? undefined : process.env,
    resourcePath: app.isPackaged
      ? join(process.resourcesPath, "oauth.json")
      : join(app.getAppPath(), "resources", "oauth.json")
  });
  const encryptionAvailable = credentials
    ? await safeEncryptionAvailability(() => safeStorage.isAsyncEncryptionAvailable())
    : false;
  const tokenStore = new TokenStore(join(app.getPath("userData"), "oauth-token.bin"), {
    backend: () => encryptionAvailable
      ? process.platform === "linux" ? safeStorage.getSelectedStorageBackend() : "os_crypt"
      : "unavailable",
    available: async () => encryptionAvailable,
    encrypt: (value) => safeStorage.encryptStringAsync(value),
    decrypt: async (value) => (await safeStorage.decryptStringAsync(value)).result
  });
  // Drive and OAuth (token/revoke) leave through the in-memory polyask-net session so they follow the
  // managed proxy (spec 3.1/3.5); Node's global fetch would bypass every proxy, system ones included.
  const netFetch = createSessionFetch(electronSession.fromPartition(NET_PARTITION), { onLogin: options.onProxyLogin });
  const oauth = new OAuthSession({
    locale: app.getLocale(),
    credentials,
    scope: "https://www.googleapis.com/auth/drive.appdata",
    tokenStore,
    fetch: netFetch,
    openExternal: async (url) => {
      const destination = new URL(url);
      if (destination.protocol !== "https:" || destination.hostname !== "accounts.google.com") {
        throw new Error("invalid_oauth_url");
      }
      await electronShell.openExternal(destination.href);
    }
  });
  return new SyncEngine({
    repository: new SyncRepository(options.database),
    drive: new DriveClient(oauth, netFetch),
    auth: oauth,
    onStatus: options.onStatus,
    onWorkspaceChanged: () => options.onWorkspace(options.workspace())
  });
}
