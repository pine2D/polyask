import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { runInNewContext } from "node:vm";
import test from "node:test";
import { transformSync } from "esbuild";

import { readSource } from "./fixtures";

const SITE = "persist:polyask-sites";

function loadProxyServices(platform: NodeJS.Platform = "linux", env: Record<string, string | undefined> = {}) {
  const require = createRequire(resolve(__dirname, "../src/main/proxy-services.ts"));
  const realSecrets = require("./secret-file-store");
  const partitions = new Map<string, { partition: string }>();
  const fromPartition = (partition: string) => {
    const existing = partitions.get(partition);
    if (existing) return existing;
    const created = { partition };
    partitions.set(partition, created);
    return created;
  };
  const app = Object.assign(new EventEmitter(), {
    getPath: (name: string) => name === "userData" ? "/profile" : `/unexpected/${name}`,
    setProxy: async () => {}
  });
  const contents = [
    { id: 1, session: fromPartition(SITE), isDestroyed: () => false },
    { id: 2, session: fromPartition(SITE), isDestroyed: () => true },
    { id: 3, session: fromPartition(""), isDestroyed: () => false }
  ];
  const storage: { backend: string; available: boolean | Error } = { backend: "gnome_libsecret", available: true };
  const safeStorage = {
    getSelectedStorageBackend: () => storage.backend,
    isAsyncEncryptionAvailable: async () => {
      if (storage.available instanceof Error) throw storage.available;
      return storage.available;
    },
    encryptStringAsync: async (value: string) => Buffer.from(`enc:${value}`),
    decryptStringAsync: async (value: Buffer) => ({ result: value.toString().replace(/^enc:/, ""), shouldReEncrypt: false })
  };
  const built: { secrets?: any; auth?: any; store?: any; runtime?: any } = {};
  const managedSessions = () => [];
  const verifySessions = () => [];
  const linuxSourceCalls: unknown[][] = [];
  // linuxDesktopProxySource 的分类本身由 T11 的 proxy-runtime.test.ts 覆盖；这里只核对装配把哪份 platform/env 交给它。
  const linuxDesktopProxySource = (...args: unknown[]) => { linuxSourceCalls.push(args); return "env"; };
  class FakeSecretFileStore {
    reads = 0;
    constructor(readonly path: string, readonly crypto: unknown, readonly opts: { invalidCode?: string }) { built.secrets = this; }
    read() { this.reads += 1; return Promise.resolve({ kind: "none" }); }
    securePersistence() { return Promise.resolve(true); }
    clear() { return Promise.resolve(); }
  }
  class FakeAuth {
    logins: unknown[][] = [];
    constructor(readonly opts: { store: unknown }) { built.auth = this; }
    handleAppLogin(...args: unknown[]) { this.logins.push(args); }
  }
  class FakeStore {
    constructor(readonly db: unknown) { built.store = this; }
  }
  class FakeRuntime {
    constructor(readonly opts: any) { built.runtime = this; }
  }
  const processStub = { platform, env };
  const module = { exports: {} as any };
  runInNewContext(transformSync(readSource("src/main/proxy-services.ts"), { loader: "ts", format: "cjs" }).code, {
    module, exports: module.exports, process: processStub,
    require: (name: string) => {
      if (name === "electron") return { app, safeStorage, session: { fromPartition }, webContents: { getAllWebContents: () => contents } };
      if (name === "./secret-file-store") return { SecretFileStore: FakeSecretFileStore, safeEncryptionAvailability: realSecrets.safeEncryptionAvailability };
      if (name === "./proxy-auth") return { ProxyAuth: FakeAuth };
      if (name === "./proxy-preference-store") return { ProxyPreferenceStore: FakeStore };
      if (name === "./proxy-runtime") return { ProxyRuntime: FakeRuntime, linuxDesktopProxySource };
      if (name === "./proxy-sessions") return { SITE_PARTITION: SITE, NET_PARTITION: "polyask-net", managedSessions, verifySessions };
      return require(name);
    }
  });
  return { exports: module.exports, app, built, storage, managedSessions, verifySessions, linuxSourceCalls, processStub };
}

test("proxy services wire one secret file, one auth, one store and the runtime's sessions", () => {
  const h = loadProxyServices();
  const database = { marker: "database" };
  const services = h.exports.createProxyServices(database);
  const { secrets, auth, store, runtime } = h.built;
  assert.equal(secrets.path, join("/profile", "proxy-secret.bin"));
  assert.equal(h.exports.PROXY_SECRET_FILE, "proxy-secret.bin");
  assert.equal(secrets.opts.invalidCode, "proxy_invalid");
  assert.equal(auth.opts.store === secrets, true, "proxy-auth reads the proxy secret file, never the OAuth token");
  assert.equal(runtime.opts.secrets === secrets, true, "wipeSecrets clears the very file proxy-auth reads (spec §4.6)");
  assert.equal(store.db === database, true);
  assert.equal(runtime.opts.sessions === h.managedSessions, true, "site, default and polyask-net come from proxy-sessions");
  assert.equal(runtime.opts.verifySessions === h.verifySessions, true,
    "only the site partition and polyask-net are verified with resolveProxy (proxy-sessions.verifySessions)");
  assert.equal(runtime.opts.app === h.app, true, "app.setProxy is the fallback for session-less requests");
  assert.equal(runtime.opts.auth === auth && runtime.opts.store === store, true);
  assert.deepEqual(Array.from(runtime.opts.webContents(), (c: { id: number }) => c.id), [1],
    "the WebRTC sweep touches live site views only, never the shell");
  assert.equal(services.runtime === runtime && services.auth === auth && services.store === store && services.secrets === secrets, true);
  assert.equal(secrets.reads, 0, "startup never reads the password; the first 407 does");
  // preflight R4：加密可用性只经 auth.securePersistence()（T8 → T14）读取，runtime 的 environment 不带 encryption。
  assert.equal("encryption" in runtime.opts.environment, false, "the runtime never probes encryption itself");
});

test("the Linux desktop-proxy source is computed from the real platform and environment at assembly", () => {
  const env = { XDG_CURRENT_DESKTOP: "XFCE", https_proxy: "http://127.0.0.1:7890" };
  const h = loadProxyServices("linux", env);
  h.exports.createProxyServices({});
  assert.equal(h.linuxSourceCalls.length, 1, "computed once per process, not per state() read");
  assert.equal(h.linuxSourceCalls[0][0], "linux");
  assert.equal(h.linuxSourceCalls[0][1] === h.processStub.env, true, "process.env itself, so the hint reflects how PolyAsk was launched");
  assert.equal(h.built.runtime.opts.environment.linuxDesktopProxy, "env",
    "without this, state().linuxDesktopProxy stays null and the §6.2 hint never shows");
});

test("site-view proxy 407s reach proxy-auth through a single app login listener", () => {
  const h = loadProxyServices();
  h.exports.createProxyServices({});
  assert.equal(h.app.listenerCount("login"), 1);
  const args = [{ preventDefault() {} }, { id: 1 }, { url: "https://claude.ai/", firstAuthAttempt: true },
    { isProxy: true, scheme: "basic", host: "proxy.example", port: 8080, realm: "r" }, () => {}];
  h.app.emit("login", ...args);
  assert.equal(h.built.auth.logins.length, 1);
  assert.equal(h.built.auth.logins[0].length, 5);
  assert.equal(h.built.auth.logins[0].every((value: unknown, index: number) => value === args[index]), true,
    "event, webContents, details, authInfo and callback are forwarded untouched");
});

test("the proxy secret crypto checks async encryption itself instead of reusing OAuth's flag", async () => {
  const linux = loadProxyServices("linux");
  const crypto = linux.exports.proxySecretCrypto();
  assert.equal(crypto.backend(), "gnome_libsecret");
  linux.storage.backend = "basic_text";
  assert.equal(crypto.backend(), "basic_text", "SecretFileStore.securePersistence excludes basic_text itself");
  assert.equal(await crypto.available(), true);
  linux.storage.available = false;
  assert.equal(await crypto.available(), false);
  linux.storage.available = new Error("keyring locked");
  assert.equal(await crypto.available(), false, "a throwing availability probe means no secure backend");
  assert.equal(await crypto.decrypt(await crypto.encrypt("pw")), "pw");
  const windows = loadProxyServices("win32");
  assert.equal(windows.exports.proxySecretCrypto().backend(), "os_crypt");
});
