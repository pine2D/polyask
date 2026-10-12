import assert from "node:assert/strict";
import test from "node:test";

import { DriveClient, type AccessTokenProvider } from "../src/main/drive-client";
import {
  authorizeWithPkce,
  exchangeAuthorizationCode,
  refreshAccessToken,
  revokeGoogleToken
} from "../src/main/oauth-pkce";
import { isProxyNetError } from "../src/main/proxy-net-error";

// net.request 适配器（main/net-request-fetch.ts）把 Chromium 错误名原样放进 Error.message。
// 代理/隧道/SOCKS 类失败要和普通断网区分开：前者让用户去查代理设置，后者让用户去查网络。
const PROXY_NAMES = [
  "net::ERR_PROXY_CONNECTION_FAILED",
  "net::ERR_PROXY_AUTH_UNSUPPORTED",
  "net::ERR_PROXY_CERTIFICATE_INVALID",
  "net::ERR_TUNNEL_CONNECTION_FAILED",
  "net::ERR_SOCKS_CONNECTION_FAILED",
  "net::ERR_SOCKS_CONNECTION_HOST_UNREACHABLE",
  "net::ERR_MANDATORY_PROXY_CONFIGURATION_FAILED"
];
const NON_PROXY_NAMES = [
  "net::ERR_CONNECTION_REFUSED",
  "net::ERR_NAME_NOT_RESOLVED",
  "net::ERR_INTERNET_DISCONNECTED",
  "fetch failed",
  "ERR_PROXY_CONNECTION_FAILED",
  " net::ERR_PROXY_CONNECTION_FAILED"
];
const CLIENT = { clientId: "client.apps.googleusercontent.com", clientSecret: "desktop-test-secret" };
const TOKEN_INPUT = { ...CLIENT, code: "code", verifier: "verifier", redirectUri: "http://127.0.0.1:43123" };
const failingFetch = (message: string): typeof globalThis.fetch => async () => { throw new Error(message); };
const stalledUntilAbort = (message: string): typeof globalThis.fetch => async (_input, init) => new Promise((_resolve, reject) => {
  const fallback = setTimeout(() => reject(new Error("test_deadline_missing")), 500);
  init?.signal?.addEventListener("abort", () => { clearTimeout(fallback); reject(new Error(message)); }, { once: true });
});
const withMessage = (expected: string) => (error: unknown) => (error as Error).message === expected;
const withCode = (expected: string) => (error: unknown) => (error as { code?: string }).code === expected;

test("only Chromium proxy, tunnel and SOCKS error names count as proxy failures", () => {
  for (const name of PROXY_NAMES) assert.equal(isProxyNetError(new Error(name)), true, name);
  for (const name of NON_PROXY_NAMES) assert.equal(isProxyNetError(new Error(name)), false, name);
  assert.equal(isProxyNetError({ message: "net::ERR_TUNNEL_CONNECTION_FAILED" }), true);
  for (const value of [null, undefined, "net::ERR_PROXY_CONNECTION_FAILED", 42, { message: 42 }, new TypeError("fetch failed")]) {
    assert.equal(isProxyNetError(value), false, String(value));
  }
});

test("Drive reports a proxy failure as proxy_error and keeps other transport failures as network_error", async () => {
  const provider: AccessTokenProvider = { accessToken: async () => "token" };
  for (const name of PROXY_NAMES) {
    await assert.rejects(() => new DriveClient(provider, failingFetch(name)).getStartToken(), (error: unknown) =>
      withCode("proxy_error")(error) && (error as { status?: number }).status === 0, name);
  }
  for (const name of NON_PROXY_NAMES) {
    await assert.rejects(() => new DriveClient(provider, failingFetch(name)).getStartToken(), withCode("network_error"), name);
  }
  await assert.rejects(
    () => new DriveClient(provider, async () => { throw new TypeError("fetch failed"); }).getStartToken(),
    withCode("network_error")
  );
});

test("a Drive deadline still wins over a proxy error raised by the abort", async () => {
  const provider: AccessTokenProvider = { accessToken: async () => "token" };
  await assert.rejects(
    () => new DriveClient(provider, stalledUntilAbort("net::ERR_PROXY_CONNECTION_FAILED"), 10).getStartToken(),
    withCode("network_timeout")
  );
});

test("OAuth token, refresh and revoke requests report proxy failures as proxy_error", async () => {
  for (const name of PROXY_NAMES) {
    await assert.rejects(() => exchangeAuthorizationCode({ ...TOKEN_INPUT, fetch: failingFetch(name) }), withMessage("proxy_error"), name);
    await assert.rejects(() => refreshAccessToken(CLIENT, "refresh-token", failingFetch(name)), withMessage("proxy_error"), name);
    await assert.rejects(() => revokeGoogleToken("token", failingFetch(name)), withMessage("proxy_error"), name);
  }
  for (const name of NON_PROXY_NAMES) {
    await assert.rejects(() => exchangeAuthorizationCode({ ...TOKEN_INPUT, fetch: failingFetch(name) }), withMessage("network_error"), name);
    await assert.rejects(() => revokeGoogleToken("token", failingFetch(name)), withMessage("network_error"), name);
  }
});

test("an OAuth deadline still wins over a proxy error raised by the abort", async () => {
  const stalled = stalledUntilAbort("net::ERR_TUNNEL_CONNECTION_FAILED");
  await assert.rejects(() => exchangeAuthorizationCode({ ...TOKEN_INPUT, fetch: stalled, timeoutMs: 10 }), withMessage("network_timeout"));
  await assert.rejects(() => revokeGoogleToken("token", stalled, 10), withMessage("network_timeout"));
});

test("browser authorization hands the injected fetch to the token exchange", async () => {
  let resolveReceive!: (value: { code?: string; state?: string; error?: string }) => void;
  const receive = new Promise<{ code?: string; state?: string; error?: string }>((resolve) => { resolveReceive = resolve; });
  const requested: string[] = [];
  await assert.rejects(() => authorizeWithPkce({
    ...CLIENT,
    scope: "https://www.googleapis.com/auth/drive.appdata",
    openExternal: async (url) => {
      resolveReceive({ code: "code", state: new URL(url).searchParams.get("state") ?? undefined });
    },
    listen: async () => ({ port: 43_123, receive, expect: () => {}, close: async () => {} }),
    fetch: async (input) => {
      requested.push(String(input));
      throw new Error("net::ERR_PROXY_CONNECTION_FAILED");
    },
    timeoutMs: 5_000
  }), withMessage("proxy_error"));
  assert.deepEqual(requested, ["https://oauth2.googleapis.com/token"]);
});

// Cancelled proxy auth: Chromium most likely answers 407 (HTTPS CONNECT included) and the body read then
// fails with the tunnel error. Both shapes, and a TypeError-typed rejection, must land on proxy_error.
const erroringBody = (status: number): typeof globalThis.fetch => async () => new Response(new ReadableStream({
  start(controller) { controller.error(new TypeError("net::ERR_TUNNEL_CONNECTION_FAILED")); }
}), { status });
const status407: typeof globalThis.fetch = async () => new Response(null, { status: 407 });
const typeErrorProxy: typeof globalThis.fetch = async () => { throw new TypeError("net::ERR_PROXY_CONNECTION_FAILED"); };

test("Drive maps 407, proxy body-read errors and TypeError proxy rejections to proxy_error", async () => {
  const provider: AccessTokenProvider = { accessToken: async () => "token" };
  for (const stub of [status407, erroringBody(407), erroringBody(500), typeErrorProxy]) {
    await assert.rejects(() => new DriveClient(provider, stub).getStartToken(), withCode("proxy_error"));
  }
});

test("OAuth maps 407, proxy body-read errors and TypeError proxy rejections to proxy_error", async () => {
  for (const stub of [status407, erroringBody(407), erroringBody(200), typeErrorProxy]) {
    await assert.rejects(() => exchangeAuthorizationCode({ ...TOKEN_INPUT, fetch: stub }), withMessage("proxy_error"));
    await assert.rejects(() => refreshAccessToken(CLIENT, "refresh-token", stub), withMessage("proxy_error"));
  }
  for (const stub of [status407, typeErrorProxy]) {
    await assert.rejects(() => revokeGoogleToken("token", stub), withMessage("proxy_error"));
  }
});
