import assert from "node:assert/strict";
import test from "node:test";

import type { AuthInfo, ProxyConfig, Session } from "electron";

import { createSessionFetch } from "../src/main/net-request-fetch";
import { encodeProxySecret, ProxyAuth } from "../src/main/proxy-auth";
import {
  PROBE_URL, PROBE_VERIFY_WINDOW_MS, ProxyProbe, classifyProbeError, storedPasswordReader, type ProbeFailure, type ProxyProbeOptions
} from "../src/main/proxy-probe";
import type { SecretReadResult } from "../src/main/secret-file-store";
import { PROXY_CHECK_URL, expectedResolve, toProxyConfig, type ProxyPreference } from "../src/shared/proxy-preference";
import { readSource } from "./fixtures";
import { clientRequestStub, proxyAuthInfo, type StubRequest } from "./support/client-request-stub";

// 与 proxyAuthInfo() 的 host/port 一致：桩发出的 407 来自被测代理本身。
const VALUE: ProxyPreference = {
  version: 1, mode: "custom", scheme: "http", host: "proxy.example.test", port: 8080, bypass: [], username: "alice"
};
const SYSTEM: ProxyPreference = { version: 1, mode: "system", scheme: "http", host: "", port: 0, bypass: [], username: "" };
const IDENTITY = { scheme: "http", host: "proxy.example.test", port: 8080, username: "alice" } as const;

type Resolve = (url: string) => string;
const viaProxy: Resolve = (url) => url === PROXY_CHECK_URL ? String(expectedResolve(VALUE)) : "PROXY proxy.example.test:8080";

interface Clock { t: number }
interface Setup {
  readonly probe: ProxyProbe;
  readonly calls: string[];
  readonly configs: ProxyConfig[];
  readonly requests: StubRequest[];
  readonly slept: number[];
  readonly session: Session;
}

function setup(
  onEnd: (request: StubRequest, clock: Clock, index: number) => void,
  options: { resolve?: Resolve; setProxyError?: Error; extra?: Partial<ProxyProbeOptions> } = {}
): Setup {
  const clock: Clock = { t: 1_000 };
  const calls: string[] = [];
  const configs: ProxyConfig[] = [];
  const slept: number[] = [];
  const resolve = options.resolve ?? viaProxy;
  const fake = {
    async clearAuthCache() { calls.push("clearAuthCache"); },
    async closeAllConnections() { calls.push("closeAllConnections"); },
    async clearHostResolverCache() { calls.push("clearHostResolverCache"); },
    async setProxy(config: ProxyConfig) {
      calls.push("setProxy");
      if (options.setProxyError) throw options.setProxyError;
      configs.push(config);
    },
    async resolveProxy(url: string) {
      calls.push(url === PROXY_CHECK_URL ? "resolveProxy:check" : url === PROBE_URL ? "resolveProxy:probe" : `resolveProxy:${url}`);
      return resolve(url);
    }
  };
  const session = fake as unknown as Session;
  const stub = clientRequestStub((request, index) => onEnd(request, clock, index));
  const probe = new ProxyProbe({
    session: () => session,
    fetchFor: (target, onLogin) => createSessionFetch(target, { request: stub.request, onLogin }),
    translate: toProxyConfig,
    now: () => clock.t,
    sleep: async (ms) => { slept.push(ms); clock.t += ms; },
    ...options.extra
  });
  return { probe, calls, configs, requests: stub.requests, slept, session };
}

async function expectFailure(run: Promise<unknown>, result: ProbeFailure, label: string): Promise<void> {
  const outcome = await run as { ok: boolean; result?: string };
  assert.equal(outcome.ok, false, `${label} must fail`);
  assert.equal(outcome.result, result, label);
}

function fakeStore(read: () => Promise<SecretReadResult>) {
  let reads = 0;
  return { store: { read: () => { reads += 1; return read(); } }, reads: () => reads };
}

test("rejects invalid values and passwords before touching the probe session", async () => {
  const { probe, calls, requests } = setup((request) => request.respond(204));
  const cases: Array<[unknown, unknown, string]> = [
    [{ ...VALUE, host: "proxy.example.test:8080" }, undefined, "host with port"],
    [{ ...VALUE, extra: true }, undefined, "extra field"],
    ["proxy.example.test", undefined, "not an object"],
    [{ ...VALUE, bypass: ["*"] }, undefined, "bypass that swallows the check host"],
    [VALUE, "", "empty password"],
    [VALUE, "pa\u0000ss", "control character"],
    [VALUE, "x".repeat(1025), "password over 1024"],
    [VALUE, 42, "non-string password"],
    [{ ...VALUE, scheme: "socks5", username: "" }, "secret", "SOCKS has no authentication"],
    [{ ...VALUE, mode: "direct" }, "secret", "password without a custom identity"]
  ];
  for (const [input, password, label] of cases) await expectFailure(probe.test(input, password), "proxy_invalid", label);
  assert.equal(calls.length, 0, "invalid input never reaches the session");
  assert.equal(requests.length, 0);
});

test("cleans the probe session, applies the translated config and verifies it before requesting", async () => {
  const { probe, calls, configs, requests, session } = setup((request, clock) => { clock.t += 42; request.respond(204); });
  const result = await probe.test(VALUE);
  assert.deepEqual(result, { ok: true, ms: 42, route: "proxy" });
  assert.deepEqual(calls, [
    "clearAuthCache", "closeAllConnections", "clearHostResolverCache", "setProxy",
    "resolveProxy:check", "resolveProxy:probe", "clearAuthCache"
  ]);
  assert.equal(configs.length, 1);
  const expected = toProxyConfig(VALUE);
  assert.equal(configs[0].mode, expected.mode);
  assert.equal(configs[0].proxyRules, expected.proxyRules);
  assert.equal(configs[0].proxyBypassRules, expected.proxyBypassRules);
  assert.equal(requests.length, 1);
  const options = requests[0].options;
  assert.equal(options.url, PROBE_URL);
  assert.equal(options.method, "GET");
  assert.equal(options.cache, "no-store");
  assert.equal(options.useSessionCookies, false);
  assert.equal(options.session === session, true, "the request runs on the probe session");
});

test("reports route=direct when the bypass list sends the probe URL direct", async () => {
  const bypassed = { ...VALUE, bypass: ["*.gstatic.com"] };
  const { probe } = setup((request) => request.respond(204), {
    resolve: (url) => url === PROXY_CHECK_URL ? String(expectedResolve(VALUE)) : "DIRECT"
  });
  const result = await probe.test(bypassed);
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.route, "direct");
});

test("system mode skips the CHECK_URL comparison", async () => {
  const { probe, calls } = setup((request) => request.respond(204), { resolve: () => "PROXY corp.example.test:3128" });
  const result = await probe.test(SYSTEM);
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.route, "proxy");
  assert.equal(calls.includes("resolveProxy:check"), false);
});

test("a CHECK_URL mismatch is proxy_apply_failed after a bounded retry and sends no request", async () => {
  const { probe, calls, requests, slept } = setup((request) => request.respond(204), { resolve: () => "DIRECT" });
  await expectFailure(probe.test(VALUE), "proxy_apply_failed", "resolveProxy never matches");
  assert.equal(slept.reduce((sum, ms) => sum + ms, 0), PROBE_VERIFY_WINDOW_MS);
  assert.equal(calls.filter((call) => call === "resolveProxy:check").length > 1, true, "retried before giving up");
  assert.equal(requests.length, 0);
});

test("a rejected setProxy is proxy_apply_failed", async () => {
  const { probe, requests } = setup((request) => request.respond(204), { setProxyError: new Error("invalid mode") });
  await expectFailure(probe.test(VALUE), "proxy_apply_failed", "setProxy rejects");
  assert.equal(requests.length, 0);
});

test("hands the typed password to the tested proxy; a rejected password is proxy_auth_failed", async () => {
  const seen: Array<[string | undefined, string | undefined]> = [];
  const { probe } = setup((request) => {
    request.login(proxyAuthInfo(), (username, password) => {
      seen.push([username, password]);
      if (password === "right") { request.respond(204); return; }
      // 代理再回一次 407：同一请求第二次进入，测试不再交凭据；Chromium 随后报隧道失败。
      request.login(proxyAuthInfo(), (retryUser, retryPassword) => {
        seen.push([retryUser, retryPassword]);
        request.fail("net::ERR_TUNNEL_CONNECTION_FAILED");
      });
    });
  });
  const ok = await probe.test(VALUE, "right");
  assert.equal(ok.ok, true, "correct password succeeds");
  await expectFailure(probe.test(VALUE, "wrong"), "proxy_auth_failed", "wrong password");
  assert.deepEqual(seen, [["alice", "right"], ["alice", "wrong"], [undefined, undefined]]);
});

test("falls back to the stored password only for the same identity; a typed password wins", async () => {
  const seen: Array<string | undefined> = [];
  const { store } = fakeStore(async () => ({ kind: "ok", value: encodeProxySecret(IDENTITY, "stored") }));
  const reader = storedPasswordReader(store, { credentialFor: () => undefined, wipeEpoch: () => 0 });
  const { probe } = setup((request) => {
    request.login(proxyAuthInfo(), (_username, password) => {
      seen.push(password);
      if (password) request.respond(204); else request.fail("net::ERR_PROXY_AUTH_REQUESTED");
    });
  }, { extra: { storedPassword: reader } });
  assert.equal((await probe.test(VALUE)).ok, true, "stored password for the same identity");
  await expectFailure(probe.test({ ...VALUE, username: "bob" }), "proxy_auth_failed", "username differs from the stored identity");
  assert.equal((await probe.test(VALUE, "typed")).ok, true, "typed password");
  assert.deepEqual(seen, ["stored", undefined, "typed"]);
});

test("a 407 from another host gets no credentials", async () => {
  const seen: Array<string | undefined> = [];
  const other: AuthInfo = { ...proxyAuthInfo(), host: "other.example.test" };
  const { probe } = setup((request) => {
    request.login(other, (_username, password) => { seen.push(password); request.fail("net::ERR_TUNNEL_CONNECTION_FAILED"); });
  });
  await expectFailure(probe.test(VALUE, "right"), "proxy_auth_failed", "foreign proxy host");
  assert.deepEqual(seen, [undefined]);
});

test("maps Chromium error names and HTTP statuses to probe results", async () => {
  const table: Array<[string, ProbeFailure]> = [
    ["net::ERR_PROXY_CONNECTION_FAILED", "proxy_failed"],
    ["net::ERR_TUNNEL_CONNECTION_FAILED", "proxy_failed"],
    ["net::ERR_SOCKS_CONNECTION_FAILED", "proxy_failed"],
    ["net::ERR_SOCKS_CONNECTION_HOST_UNREACHABLE", "proxy_failed"],
    ["net::ERR_PROXY_CERTIFICATE_INVALID", "proxy_failed"],
    ["net::ERR_MANDATORY_PROXY_CONFIGURATION_FAILED", "proxy_failed"],
    ["net::ERR_PROXY_AUTH_REQUESTED", "proxy_auth_failed"],
    ["net::ERR_PROXY_AUTH_UNSUPPORTED", "proxy_auth_failed"],
    ["net::ERR_NAME_NOT_RESOLVED", "network_error"],
    ["net::ERR_CONNECTION_REFUSED", "network_error"],
    ["net::ERR_TIMED_OUT", "network_timeout"],
    ["net::ERR_CONNECTION_TIMED_OUT", "network_timeout"]
  ];
  for (const [name, expected] of table) {
    const { probe } = setup((request) => request.fail(name));
    await expectFailure(probe.test(VALUE), expected, name);
  }
  await expectFailure(setup((request) => request.respond(407)).probe.test(VALUE), "proxy_auth_failed", "HTTP 407");
  await expectFailure(setup((request) => request.respond(503)).probe.test(VALUE), "network_error", "HTTP 503");
  assert.equal(classifyProbeError(new DOMException("Timed out", "TimeoutError"), true), "network_timeout");
  assert.equal(classifyProbeError("not an error", false), "network_error");
});

test("a request that never answers times out as network_timeout and is aborted", async () => {
  const { probe, requests } = setup(() => undefined, { extra: { timeoutMs: 20 } });
  await expectFailure(probe.test(VALUE), "network_timeout", "no response");
  assert.equal(requests.length, 1);
  assert.equal(requests[0].aborted >= 1, true, "the hanging request is aborted");
});

test("only one test runs at a time", async () => {
  let held: StubRequest | null = null;
  let markHeld: () => void = () => undefined;
  const heldSeen = new Promise<void>((resolve) => { markHeld = resolve; });
  const { probe } = setup((request, _clock, index) => {
    if (index === 0) { held = request; markHeld(); return; }
    request.respond(204);
  });
  const first = probe.test(VALUE);
  await heldSeen;
  await expectFailure(probe.test(VALUE), "proxy_test_busy", "second concurrent test");
  (held as StubRequest | null)?.respond(204);
  assert.equal((await first).ok, true);
  assert.equal((await probe.test(VALUE)).ok, true, "a new test runs after the first one settles");
});

test("storedPasswordReader honours tombstones, wipes, unreadable files and identity", async () => {
  const saved = fakeStore(async () => ({ kind: "ok", value: encodeProxySecret(IDENTITY, "stored") }));
  let cached: string | null | undefined = null;
  let epoch = 0;
  const auth = { credentialFor: () => cached, wipeEpoch: () => epoch };
  assert.equal(await storedPasswordReader(saved.store, auth)(IDENTITY), null, "tombstone, wipe or another identity: no disk read");
  assert.equal(saved.reads(), 0);
  cached = "memory";
  assert.equal(await storedPasswordReader(saved.store, auth)(IDENTITY), "memory", "the in-memory credential wins over the file");
  assert.equal(saved.reads(), 0);
  cached = undefined;
  assert.equal(await storedPasswordReader(saved.store, auth)(IDENTITY), "stored");
  assert.equal(await storedPasswordReader(saved.store, auth)({ ...IDENTITY, host: "PROXY.example.test" }), "stored", "host compares normalized");
  assert.equal(await storedPasswordReader(saved.store, auth)({ ...IDENTITY, port: 8081 }), null, "port differs");
  assert.equal(await storedPasswordReader(saved.store, auth)({ ...IDENTITY, scheme: "https" }), null, "scheme differs");
  assert.equal(await storedPasswordReader(saved.store, auth)({ ...IDENTITY, username: "bob" }), null, "username differs");
  const wiped = fakeStore(async () => { epoch += 1; return { kind: "ok", value: encodeProxySecret(IDENTITY, "stored") }; });
  assert.equal(await storedPasswordReader(wiped.store, auth)(IDENTITY), null, "a reset during the read discards it");
  const replaced = fakeStore(async () => { cached = null; return { kind: "ok", value: encodeProxySecret(IDENTITY, "stored") }; });
  assert.equal(await storedPasswordReader(replaced.store, auth)(IDENTITY), null, "a tombstone installed during the read wins");
  cached = undefined;
  const unreadable = fakeStore(async () => ({ kind: "unreadable" }));
  assert.equal(await storedPasswordReader(unreadable.store, auth)(IDENTITY), null);
  const v6 = fakeStore(async () => ({ kind: "ok", value: encodeProxySecret({ ...IDENTITY, host: "::1" }, "v6") }));
  assert.equal(await storedPasswordReader(v6.store, auth)({ ...IDENTITY, host: "::1" }), "v6");
});

/** 真实 ProxyAuth + 同一个假密码文件：probe 读到的与 proxy-set 写进去的是同一份。 */
function sharedSecretFile(options: { secure: boolean; writeError?: Error; initial?: string }) {
  let file: string | null = options.initial ?? null;
  let reads = 0;
  const store = {
    async read(): Promise<SecretReadResult> { reads += 1; return file === null ? { kind: "none" } : { kind: "ok", value: file }; },
    async write(value: string) {
      if (options.writeError) throw options.writeError;
      if (!options.secure) return "memory" as const;
      file = value;
      return "saved" as const;
    },
    // 模拟删不掉的旧文件：只看内存优先，不依赖 persistCredential 的清理。
    async clear() { throw new Error("EBUSY"); },
    async securePersistence() { return options.secure; }
  };
  return { store, reads: () => reads };
}

test("Test connection uses the credential ProxyAuth holds for this run before the password file", async () => {
  const seen: Array<string | undefined> = [];
  const probeWith = (secrets: ReturnType<typeof sharedSecretFile>, auth: ProxyAuth) => setup((request) => {
    request.login(proxyAuthInfo(), (_username, password) => {
      seen.push(password);
      if (password) request.respond(204); else request.fail("net::ERR_PROXY_AUTH_REQUESTED");
    });
  }, { extra: { storedPassword: storedPasswordReader(secrets.store, auth) } }).probe;

  // (a) basic_text / 没有钥匙环：保存只留在内存，磁盘上没有文件。
  const memoryFile = sharedSecretFile({ secure: false });
  const memoryAuth = new ProxyAuth({ store: memoryFile.store });
  memoryAuth.beginApply(VALUE, "memory-only", true);
  memoryAuth.setBasis({ applied: VALUE, applying: null });
  await memoryAuth.persistCredential(VALUE, "memory-only", memoryAuth.wipeEpoch());
  assert.equal((await probeWith(memoryFile, memoryAuth).test(VALUE)).ok, true, "a memory-only password is tested, not reported as an auth failure");

  // (b) P1 → P2 时写盘撞上钥匙环超时：旧文件仍是同一身份的 P1，本次运行绝不再交出 P1。
  const stale = sharedSecretFile({ secure: true, writeError: new Error("secret_write_timeout"), initial: encodeProxySecret(IDENTITY, "P1") });
  const staleAuth = new ProxyAuth({ store: stale.store });
  staleAuth.beginApply(VALUE, "P2", false);
  staleAuth.setBasis({ applied: VALUE, applying: null });
  assert.equal(await staleAuth.persistCredential(VALUE, "P2", staleAuth.wipeEpoch()), "failed");
  assert.equal((await probeWith(stale, staleAuth).test(VALUE)).ok, true);

  // (c) 清除密码后是墓碑：旧文件删不掉也不读回来。
  const cleared = sharedSecretFile({ secure: true, initial: encodeProxySecret(IDENTITY, "P1") });
  const clearedAuth = new ProxyAuth({ store: cleared.store });
  clearedAuth.beginApply(VALUE, null, false);
  clearedAuth.setBasis({ applied: VALUE, applying: null });
  await expectFailure(probeWith(cleared, clearedAuth).test(VALUE), "proxy_auth_failed", "a tombstone yields no credential");

  assert.deepEqual(seen, ["memory-only", "P2", undefined]);
  assert.equal(stale.reads() + cleared.reads(), 0, "a cached answer never reads the file");
});

test("the probe never falls back to Node fetch or AbortSignal.timeout and produces no code literals", () => {
  const source = readSource("src/main/proxy-probe.ts");
  assert.doesNotMatch(source, /globalThis\.fetch|session\.fetch|AbortSignal\.timeout/);
  assert.doesNotMatch(source, /\bcode:\s*"|\.code\s*=\s*"/);
  assert.doesNotMatch(readSource("src/main/proxy-reload.ts"), /\bcode:\s*"|\.code\s*=\s*"/);
});

test("a proxy that is not running is proxy_failed, not an auth failure", async () => {
  const { probe } = setup((request) => request.fail("net::ERR_PROXY_CONNECTION_FAILED"));
  await expectFailure(probe.test(VALUE, "pw"), "proxy_failed", "connection refused by the proxy");
});

test("a Chromium call that never settles is bounded and reported as proxy_apply_failed", async () => {
  const hang = () => new Promise<void>(() => undefined);
  const { probe, requests } = setup((request) => request.respond(204), { extra: { callTimeoutMs: 20 } });
  const stuck = new ProxyProbe({
    session: () => ({ clearAuthCache: hang, closeAllConnections: hang, clearHostResolverCache: hang, setProxy: hang, resolveProxy: () => new Promise<string>(() => undefined) }) as unknown as Session,
    fetchFor: () => (async () => { throw new Error("must not be called"); }) as typeof fetch,
    translate: toProxyConfig,
    callTimeoutMs: 20
  });
  await expectFailure(stuck.test(VALUE), "proxy_apply_failed", "clearAuthCache hangs");
  assert.equal((await probe.test(VALUE)).ok, true);
  assert.equal(requests.length, 1);
});

test("a typed password that fails the shared password rule is proxy_invalid", async () => {
  const { probe, calls } = setup((request) => request.respond(204));
  await expectFailure(probe.test(VALUE, "x".repeat(1025)), "proxy_invalid", "too long");
  assert.equal(calls.length, 0);
});
