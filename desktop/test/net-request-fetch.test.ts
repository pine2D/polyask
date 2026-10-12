import assert from "node:assert/strict";
import test from "node:test";

import type { Session } from "electron";

import { DriveClient, MULTIPART_BODY_LIMIT, type AccessTokenProvider } from "../src/main/drive-client";
import { createSessionFetch, MAX_REDIRECTS } from "../src/main/net-request-fetch";
import { refreshAccessToken } from "../src/main/oauth-pkce";
import { readSource } from "./fixtures";
import { clientRequestStub, proxyAuthInfo, type StubRequest } from "./support/client-request-stub";

const session = { partition: "polyask-net-test" } as unknown as Session;
const tokens: AccessTokenProvider = { accessToken: async () => "token" };
const credentials = { clientId: "test-client.apps.googleusercontent.com", clientSecret: "test-secret-value" };
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
const json = (request: StubRequest, value: unknown) => request.respond(200, { statusMessage: "OK", headers: { "content-type": "application/json" }, chunks: [JSON.stringify(value)] });

test("session fetch opens net.request on the given session without cookies, cache or automatic redirects", async () => {
  const stub = clientRequestStub((request) => request.respond(201, {
    statusMessage: "Created",
    headers: { "content-type": "application/json", "set-cookie": ["a=1", "b=2"] },
    chunks: ["{\"ok\":", "true}"]
  }));
  const fetch = createSessionFetch(session, { request: stub.request });
  const response = await fetch("https://www.googleapis.com/drive/v3/files", { method: "post", headers: { "X-Custom": "1" }, body: "hello" });

  const sent = stub.requests[0];
  assert.equal(stub.requests.length, 1);
  assert.equal(sent.options.session === session, true, "request must be bound to the injected session");
  assert.equal(sent.options.method, "POST");
  assert.equal(sent.options.url, "https://www.googleapis.com/drive/v3/files");
  assert.equal(sent.options.useSessionCookies, false);
  assert.equal(sent.options.cache, "no-store");
  assert.equal(sent.options.redirect, "manual");
  assert.equal(sent.headers.get("x-custom"), "1");
  assert.equal(sent.headers.get("content-type"), "text/plain;charset=UTF-8");
  assert.equal(sent.bodyText(), "hello");
  assert.equal(response.ok, true);
  assert.equal(response.status, 201);
  assert.equal(response.statusText, "Created");
  assert.equal(response.headers.get("content-type"), "application/json");
  assert.equal(response.headers.get("set-cookie"), "a=1, b=2");
  assert.equal(await response.text(), "{\"ok\":true}");
});

test("session fetch encodes form and byte bodies and reports non-2xx as not ok", async () => {
  const stub = clientRequestStub((request, index) => {
    if (index === 2) { request.respond(204); return; }
    request.respond(index === 0 ? 200 : 500, { chunks: ["body"] });
  });
  const fetch = createSessionFetch(session, { request: stub.request });

  const form = await fetch("https://oauth2.googleapis.com/token", { method: "POST", body: new URLSearchParams({ a: "1", b: "x y" }) });
  assert.equal(stub.requests[0].bodyText(), "a=1&b=x+y");
  assert.equal(stub.requests[0].headers.get("content-type"), "application/x-www-form-urlencoded;charset=UTF-8");
  assert.equal(form.ok, true);

  const bytes = new Uint8Array([9, 1, 2, 3, 9]).subarray(1, 4);
  const failed = await fetch("https://www.googleapis.com/upload", { method: "PUT", headers: { "Content-Type": "application/json" }, body: bytes });
  assert.deepEqual(Array.from(stub.requests[1].bodyBytes()), [1, 2, 3]);
  assert.equal(stub.requests[1].headers.get("content-type"), "application/json");
  assert.equal(failed.ok, false);
  assert.equal(failed.status, 500);
  assert.equal(await failed.text(), "body");

  const empty = await fetch("https://www.googleapis.com/drive/v3/files/a", { method: "DELETE" });
  assert.equal(empty.status, 204);
  assert.equal(await empty.text(), "");
  assert.equal(stub.requests[2].chunks.length, 0);
});

test("session fetch rejects inputs it cannot send faithfully before opening a request", async () => {
  const stub = clientRequestStub();
  const fetch = createSessionFetch(session, { request: stub.request });
  await assert.rejects(() => fetch("https://example.test/", { method: "POST", body: new Blob(["x"]) }), (error: unknown) => (error as Error).message === "unsupported_request_body");
  await assert.rejects(() => fetch(new Request("https://example.test/")), (error: unknown) => (error as Error).message === "unsupported_request_input");
  await assert.rejects(() => fetch("file:///etc/hosts"), (error: unknown) => (error as Error).message === "unsupported_request_url");
  await assert.rejects(() => fetch("https://example.test/", { body: "x" }), (error: unknown) => (error as Error).message === "request_body_not_allowed");
  assert.equal(stub.requests.length, 0);
});

test("session fetch aborts during the request phase with the signal reason", async () => {
  const stub = clientRequestStub();
  const fetch = createSessionFetch(session, { request: stub.request });

  const already = new AbortController();
  already.abort();
  await assert.rejects(() => fetch("https://example.test/", { signal: already.signal }), (error: unknown) => (error as Error).name === "AbortError");
  assert.equal(stub.requests.length, 0, "an aborted signal must not open a request");

  const timed = new AbortController();
  const reason = new DOMException("Timed out", "TimeoutError");
  const pending = fetch("https://example.test/slow", { signal: timed.signal });
  await tick();
  timed.abort(reason);
  await assert.rejects(() => pending, (error: unknown) => error === reason);
  assert.equal(stub.requests[0].aborted, 1);

  const plain = new AbortController();
  const second = fetch("https://example.test/slow", { signal: plain.signal });
  await tick();
  plain.abort();
  await assert.rejects(() => second, (error: unknown) => (error as Error).name === "AbortError");
  assert.equal(stub.requests[1].aborted, 1);
});

test("session fetch aborts while the body is read and keeps body-phase transport errors", async () => {
  const stub = clientRequestStub((request) => request.respond(200, { chunks: ["partial"], end: false }));
  const fetch = createSessionFetch(session, { request: stub.request });

  const controller = new AbortController();
  const response = await fetch("https://example.test/body", { signal: controller.signal });
  const reason = new DOMException("Timed out", "TimeoutError");
  controller.abort(reason);
  await assert.rejects(() => response.text(), (error: unknown) => (error as Error).name === "TimeoutError");
  assert.equal(stub.requests[0].aborted, 1);

  const reset = await fetch("https://example.test/body");
  stub.requests[1].fail("net::ERR_CONNECTION_RESET");
  await assert.rejects(() => reset.text(), (error: unknown) => (error as Error).message === "net::ERR_CONNECTION_RESET");
});

test("session fetch keeps the Chromium net error name in the rejection message", async () => {
  const stub = clientRequestStub((request) => request.fail("net::ERR_PROXY_CONNECTION_FAILED"));
  const fetch = createSessionFetch(session, { request: stub.request });
  await assert.rejects(() => fetch("https://example.test/"), (error: unknown) =>
    error instanceof TypeError && error.message === "net::ERR_PROXY_CONNECTION_FAILED");
});

test("request-level login is handed to the proxy handler only for proxy challenges", async () => {
  const outcomes: number[] = [];
  const handled: boolean[] = [];
  const challenge = (isProxy: boolean) => clientRequestStub((request) => {
    request.login(proxyAuthInfo(isProxy), (...args: unknown[]) => { outcomes.push(args.length); });
    request.respond(200);
  });

  const proxied = challenge(true);
  await createSessionFetch(session, {
    request: proxied.request,
    onLogin: (request, authInfo, callback) => {
      handled.push(request === proxied.requests[0] && authInfo.isProxy);
      callback("user", "pass");
    }
  })("https://example.test/");
  assert.deepEqual(handled, [true]);
  assert.deepEqual(outcomes, [2]);

  const origin = challenge(false);
  await createSessionFetch(session, { request: origin.request, onLogin: () => handled.push(false) })("https://example.test/");
  const unhandled = challenge(true);
  await createSessionFetch(session, { request: unhandled.request })("https://example.test/");
  assert.deepEqual(handled, [true], "origin 401 and missing handler must not reach the proxy handler");
  assert.deepEqual(outcomes, [2, 0, 0], "both cases cancel with callback()");
});

test("redirects keep Authorization on the same origin and drop it across origins", async () => {
  const run = async (location: string) => {
    const stub = clientRequestStub((request, index) => {
      if (index === 0) request.redirect(302, location);
      else json(request, { ok: true });
    });
    const response = await createSessionFetch(session, { request: stub.request })("https://www.googleapis.com/a", {
      headers: { Authorization: "Bearer secret", "X-Trace": "1" }
    });
    assert.equal(response.ok, true);
    assert.equal(stub.requests.length, 2);
    assert.equal(stub.requests[0].aborted, 1, "the first hop is cancelled, not followed");
    assert.equal(stub.requests[0].followed, 0);
    assert.equal(stub.requests[1].options.url, location);
    assert.equal(stub.requests[1].headers.get("x-trace"), "1");
    return stub.requests[1].headers.get("authorization") ?? null;
  };
  assert.equal(await run("https://www.googleapis.com/b"), "Bearer secret");
  assert.equal(await run("https://storage.example.test/b"), null);
});

test("redirects follow fetch method rules and stop after the redirect limit", async () => {
  const methodAfter = async (status: number) => {
    const stub = clientRequestStub((request, index) => {
      if (index === 0) request.redirect(status, "/next");
      else request.respond(200);
    });
    await createSessionFetch(session, { request: stub.request })("https://example.test/start", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: "{}"
    });
    const next = stub.requests[1];
    return [String(next.options.method), next.bodyText(), next.headers.get("content-type") ?? "none", String(next.options.url)];
  };
  assert.deepEqual(await methodAfter(303), ["GET", "", "none", "https://example.test/next"]);
  assert.deepEqual(await methodAfter(302), ["GET", "", "none", "https://example.test/next"]);
  assert.deepEqual(await methodAfter(307), ["POST", "{}", "application/json", "https://example.test/next"]);

  const chain = (redirects: number) => clientRequestStub((request, index) => {
    if (index < redirects) request.redirect(302, `https://example.test/${index + 1}`);
    else request.respond(200);
  });
  const atLimit = chain(MAX_REDIRECTS);
  assert.equal((await createSessionFetch(session, { request: atLimit.request })("https://example.test/0")).ok, true);
  assert.equal(atLimit.requests.length, MAX_REDIRECTS + 1);
  const overLimit = chain(MAX_REDIRECTS + 1);
  await assert.rejects(() => createSessionFetch(session, { request: overLimit.request })("https://example.test/0"),
    (error: unknown) => (error as Error).message === "net::ERR_TOO_MANY_REDIRECTS");
  assert.equal(overLimit.requests.length, MAX_REDIRECTS + 1);

  const unsafe = clientRequestStub((request) => request.redirect(302, "file:///etc/passwd"));
  await assert.rejects(() => createSessionFetch(session, { request: unsafe.request })("https://example.test/0"),
    (error: unknown) => (error as Error).message === "net::ERR_UNSAFE_REDIRECT");
  assert.equal(unsafe.requests.length, 1);
});

test("real DriveClient runs success, failure, timeout and a >4MiB upload through the adapter", async () => {
  const listed = clientRequestStub((request) => json(request, { files: [{ id: "file-a" }] }));
  const files = await new DriveClient(tokens, createSessionFetch(session, { request: listed.request })).listFiles();
  assert.deepEqual(files.map((file) => file.id), ["file-a"]);
  assert.equal(listed.requests[0].headers.get("authorization"), "Bearer token");

  const refused = clientRequestStub((request) => request.fail("net::ERR_CONNECTION_REFUSED"));
  await assert.rejects(() => new DriveClient(tokens, createSessionFetch(session, { request: refused.request })).listFiles(),
    (error: unknown) => (error as { code?: string }).code === "network_error");

  const silent = clientRequestStub();
  await assert.rejects(() => new DriveClient(tokens, createSessionFetch(session, { request: silent.request }), 10).listFiles(),
    (error: unknown) => (error as { code?: string }).code === "network_timeout");
  assert.equal(silent.requests[0].aborted, 1);

  const stalled = clientRequestStub((request) => request.respond(200, { chunks: ["{\"files\":"], end: false }));
  await assert.rejects(() => new DriveClient(tokens, createSessionFetch(session, { request: stalled.request }), 10).listFiles(),
    (error: unknown) => (error as { code?: string }).code === "network_timeout");
  assert.equal(stalled.requests[0].aborted, 1);

  const content = { text: "x".repeat(MULTIPART_BODY_LIMIT + 1024) };
  const uploads = clientRequestStub((request, index) => {
    if (index === 0) request.respond(200, { headers: { location: "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=u1" } });
    else json(request, { id: "big" });
  });
  const saved = await new DriveClient(tokens, createSessionFetch(session, { request: uploads.request })).upsert(null, "big.json", { app: "polyask" }, content);
  assert.equal(saved.id, "big");
  assert.equal(uploads.requests[1].options.method, "PUT");
  assert.equal(uploads.requests[1].bodyBytes().byteLength, Buffer.byteLength(JSON.stringify(content)));
  assert.equal(uploads.requests[1].headers.get("authorization"), "Bearer token");
});

test("real OAuth token refresh runs success, failure and timeout through the adapter", async () => {
  const granted = clientRequestStub((request) => json(request, { access_token: "access", expires_in: 3600 }));
  const tokenSet = await refreshAccessToken(credentials, "refresh-value", createSessionFetch(session, { request: granted.request }), () => 1_000);
  assert.equal(tokenSet.accessToken, "access");
  assert.equal(tokenSet.expiresAt, 1_000 + 3_600_000);
  assert.equal(granted.requests[0].options.method, "POST");
  assert.equal(granted.requests[0].headers.get("content-type"), "application/x-www-form-urlencoded");
  assert.equal(new URLSearchParams(granted.requests[0].bodyText()).get("grant_type"), "refresh_token");

  const unresolved = clientRequestStub((request) => request.fail("net::ERR_NAME_NOT_RESOLVED"));
  await assert.rejects(() => refreshAccessToken(credentials, "refresh-value", createSessionFetch(session, { request: unresolved.request })),
    (error: unknown) => (error as Error).message === "network_error");

  const silent = clientRequestStub();
  await assert.rejects(() => refreshAccessToken(credentials, "refresh-value", createSessionFetch(session, { request: silent.request }), Date.now, 10),
    (error: unknown) => (error as Error).message === "network_timeout");
  assert.equal(silent.requests[0].aborted, 1);

  const stalled = clientRequestStub((request) => request.respond(200, { end: false }));
  await assert.rejects(() => refreshAccessToken(credentials, "refresh-value", createSessionFetch(session, { request: stalled.request }), Date.now, 10),
    (error: unknown) => (error as Error).message === "network_timeout");
});

test("adapter keeps the referenced-timer rule and never follows redirects inside Chromium", () => {
  const source = readSource("src/main/net-request-fetch.ts");
  assert.doesNotMatch(source, /AbortSignal\.timeout/);
  assert.doesNotMatch(source, /\.followRedirect\(/, "Authorization stripping relies on rebuilding each hop");
  assert.doesNotMatch(source, /(globalThis|session|net)\.fetch\(/, "the adapter itself must not fall back to another fetch");
});
