import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import test from "node:test";
import { transformSync } from "esbuild";

import type { AuthInfo, IpcMainInvokeEvent } from "electron";

import { encodeProxySecret } from "../src/main/proxy-auth";
import { PROXY_IPC_CHANNELS, registerProxyIpc, type ProxyIpcListener, type ProxyIpcOptions } from "../src/main/proxy-ipc";
import type { SiteReloader } from "../src/main/proxy-reload";
import { SITE_KEYS, type SiteKey } from "../src/shared/contracts";
import { PROXY_CHECK_URL, expectedResolve, type ProxyPreference } from "../src/shared/proxy-preference";
import { readSource } from "./fixtures";
import { proxyAuthInfo } from "./support/client-request-stub";

type ProxyToolsModule = typeof import("../src/main/proxy-tools");
type LoginCallback = (username?: string, password?: string) => void;

const SITE = "persist:polyask-sites";
const PROBE = "polyask-proxy-probe";
// 与 proxyAuthInfo() 的 host/port 一致：桩发出的 407 来自被测代理本身。
const VALUE: ProxyPreference = {
  version: 1, mode: "custom", scheme: "http", host: "proxy.example.test", port: 8080, bypass: [], username: "alice"
};
const IDENTITY = { scheme: "http", host: "proxy.example.test", port: 8080, username: "alice" } as const;

interface FakeSession {
  readonly partition: string;
  readonly calls: string[];
  clearAuthCache(): Promise<void>;
  closeAllConnections(): Promise<void>;
  clearHostResolverCache(): Promise<void>;
  setProxy(): Promise<void>;
  resolveProxy(url: string): Promise<string>;
}

function wire(reload: (site: SiteKey) => boolean = () => true, selected: readonly SiteKey[] = SITE_KEYS) {
  const sessions = new Map<string, FakeSession>();
  const fromPartition = (partition: string): FakeSession => {
    const existing = sessions.get(partition);
    if (existing) return existing;
    const calls: string[] = [];
    const created: FakeSession = {
      partition, calls,
      clearAuthCache: async () => { calls.push("clearAuthCache"); },
      closeAllConnections: async () => { calls.push("closeAllConnections"); },
      clearHostResolverCache: async () => { calls.push("clearHostResolverCache"); },
      setProxy: async () => { calls.push("setProxy"); },
      resolveProxy: async (url) => url === PROXY_CHECK_URL ? String(expectedResolve(VALUE)) : "PROXY proxy.example.test:8080"
    };
    sessions.set(partition, created);
    return created;
  };
  const fetches: Array<{ target: unknown; hasRequest: boolean; hasLogin: boolean }> = [];
  const credentials: Array<[string | undefined, string | undefined]> = [];
  const createSessionFetch = (
    target: unknown,
    deps: { request?: unknown; onLogin?: (request: object, info: AuthInfo, callback: LoginCallback) => void }
  ) => {
    fetches.push({ target, hasRequest: deps.request !== undefined, hasLogin: typeof deps.onLogin === "function" });
    return async () => {
      deps.onLogin?.({}, proxyAuthInfo(), (username, password) => { credentials.push([username, password]); });
      throw new Error("net::ERR_TUNNEL_CONNECTION_FAILED");
    };
  };
  const require = createRequire(resolve(__dirname, "../src/main/proxy-tools.ts"));
  const module = { exports: {} as Record<string, unknown> };
  runInNewContext(transformSync(readSource("src/main/proxy-tools.ts"), { loader: "ts", format: "cjs" }).code, {
    module, exports: module.exports,
    require: (name: string) => {
      if (name === "electron") return { session: { fromPartition } };
      if (name === "./net-request-fetch") return { createSessionFetch };
      if (name === "./proxy-sessions") return { PROBE_PARTITION: PROBE, SITE_PARTITION: SITE };
      return require(name);
    }
  });
  const { createProxyTools } = module.exports as unknown as ProxyToolsModule;
  const reloaded: SiteKey[] = [];
  const manager: SiteReloader = { reload: (site) => { reloaded.push(site); return reload(site); } };
  const services = {
    auth: { credentialFor: () => undefined, wipeEpoch: () => 0 },
    secrets: { read: async () => ({ kind: "ok", value: encodeProxySecret(IDENTITY, "stored") }) }
  } as unknown as Parameters<ProxyToolsModule["createProxyTools"]>[0];
  const handlers = new Map<string, ProxyIpcListener>();
  const dispose = registerProxyIpc({
    runtime: { bindBusySource: () => undefined, onChange: () => () => undefined } as unknown as ProxyIpcOptions["runtime"],
    auth: { onChange: () => () => undefined } as unknown as ProxyIpcOptions["auth"],
    store: {} as unknown as ProxyIpcOptions["store"],
    ...createProxyTools(services, manager, () => selected),
    trusted: () => true,
    gate: { busy: false, onIdle: () => () => undefined, run: <T>(action: () => Promise<T>) => action() } as unknown as ProxyIpcOptions["gate"],
    dataAdmin: { isResetting: false },
    send: () => undefined,
    ipc: {
      handle: (channel, listener) => { handlers.set(channel, listener); },
      removeHandler: (channel) => { handlers.delete(channel); }
    }
  });
  const invoke = async (channel: string, value?: unknown): Promise<unknown> => {
    const handler = handlers.get(channel);
    assert.ok(handler, `${channel} is registered`);
    return handler({} as IpcMainInvokeEvent, value);
  };
  return { sessions, fetches, credentials, reloaded, handlers, dispose, invoke };
}

test("production tools register proxy-test, which probes on the in-memory partition with the stored password", async () => {
  const h = wire();
  for (const channel of PROXY_IPC_CHANNELS) assert.equal(h.handlers.has(channel), true, `${channel} is registered in production`);
  const result = await h.invoke("polyask:proxy-test", { value: VALUE }) as { ok: boolean; result?: string };
  assert.equal(result.ok, false);
  assert.equal(result.result, "proxy_failed", "the real probe classifies the stubbed tunnel failure");
  assert.deepEqual([...h.sessions.keys()], [PROBE], "a test never touches the site partition");
  assert.deepEqual(h.sessions.get(PROBE)?.calls,
    ["clearAuthCache", "closeAllConnections", "clearHostResolverCache", "setProxy", "clearAuthCache"]);
  assert.equal(h.fetches.length, 1);
  assert.equal(h.fetches[0].target === h.sessions.get(PROBE), true, "the request runs on the probe session");
  assert.equal(h.fetches[0].hasRequest, false, "production requests go through electron net.request");
  assert.equal(h.fetches[0].hasLogin, true, "the probe's request-level login reaches the adapter");
  assert.deepEqual(h.credentials, [["alice", "stored"]], "the stored password is read from proxy.secrets for the same identity");
  h.dispose();
  assert.equal(h.handlers.size, 0, "closing the window unregisters every proxy channel");
});

test("production tools register proxy-reload-sites, which closes site connections and reloads this window's views", async () => {
  const h = wire((site) => site !== "kimi");
  const result = await h.invoke("polyask:proxy-reload-sites") as { ok: boolean; skipped?: readonly string[] };
  assert.equal(result.ok, true);
  assert.deepEqual(result.skipped, ["kimi"]);
  assert.deepEqual([...h.sessions.keys()], [SITE]);
  assert.deepEqual(h.sessions.get(SITE)?.calls, ["closeAllConnections"]);
  assert.deepEqual(h.reloaded, [...SITE_KEYS]);
  h.dispose();
});

test("the production window hands the tools to the shell IPC proxy option after building its ViewManager", () => {
  const index = readSource("src/main/index.ts");
  assert.match(index, /import \{ createProxyTools \} from "\.\/proxy-tools";/);
  assert.match(index, /dataAdmin, preferences, proxy: \{ \.\.\.proxy, \.\.\.createProxyTools\(proxy, manager, \(\) => workspace\.getState\(\)\.selectedSites\) \},/);
  assert.equal(index.split("createProxyTools(").length, 2, "assembled once per window");
  assert.ok(index.indexOf("new ViewManager(") < index.indexOf("createProxyTools(proxy, manager"),
    "reload-all-sites needs this window's ViewManager");
});

test("reload-sites reloads only the selected sites", async () => {
  const h = wire(() => true, ["claude", "kimi"]);
  const result = await h.invoke("polyask:proxy-reload-sites") as { ok: boolean; skipped?: readonly string[] };
  assert.deepEqual(result.skipped, []);
  assert.deepEqual(h.reloaded, ["claude", "kimi"]);
  h.dispose();
});
