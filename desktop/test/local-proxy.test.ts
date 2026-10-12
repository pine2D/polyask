import assert from "node:assert/strict";
import { once } from "node:events";
import { request as httpRequest } from "node:http";
import { connect as netConnect } from "node:net";
import test from "node:test";

import { splitHostPort, startHttpProxy, startOrigin, startSocksProxy } from "./support/local-proxy";

const ORIGIN_HOST = "origin.polyask.test";

/** 原始 TCP 探针：只做字节级收发，不经 Node http 客户端的代理语义。 */
async function openRaw(port: number) {
  const socket = netConnect(port, "127.0.0.1");
  socket.on("error", () => {});
  await once(socket, "connect");
  let data = Buffer.alloc(0);
  let closed = false;
  const waiters: Array<() => void> = [];
  const wake = () => { for (const fn of waiters.splice(0)) fn(); };
  socket.on("data", (chunk: Buffer) => { data = Buffer.concat([data, chunk]); wake(); });
  socket.on("close", () => { closed = true; wake(); });
  const until = async (done: () => boolean) => {
    while (!done() && !closed) await new Promise<void>((resolve) => waiters.push(resolve));
  };
  return {
    write: (chunk: Buffer | string) => socket.write(chunk),
    async read(n: number): Promise<number[]> {
      await until(() => data.length >= n);
      const out = [...data.subarray(0, n)];
      data = data.subarray(n);
      return out;
    },
    async head(): Promise<string> {
      await until(() => data.includes("\r\n\r\n"));
      const end = data.indexOf("\r\n\r\n");
      const out = data.subarray(0, end < 0 ? data.length : end + 4).toString("latin1");
      data = data.subarray(end < 0 ? data.length : end + 4);
      return out;
    },
    async rest(): Promise<string> {
      await until(() => false);
      const out = data.toString("latin1");
      data = Buffer.alloc(0);
      return out;
    },
    isClosed: () => closed,
    destroy: () => socket.destroy()
  };
}

function innerGet(path: string, host: string): string {
  return `GET ${path} HTTP/1.1\r\nHost: ${host}\r\nAuthorization: Bearer inner\r\nConnection: close\r\n\r\n`;
}

function basic(username: string, password: string): string {
  return `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
}

/** 经 HTTP 代理以绝对 URI 发 GET；返回状态码与响应头。 */
async function proxiedGet(proxyPort: number, absoluteUrl: string, headers: Record<string, string> = {}) {
  const req = httpRequest({ host: "127.0.0.1", port: proxyPort, path: absoluteUrl, headers, agent: false });
  req.end();
  const [res] = await once(req, "response") as [import("node:http").IncomingMessage];
  res.resume();
  await once(res, "end");
  return { status: res.statusCode ?? 0, proxyAuthenticate: res.headers["proxy-authenticate"] ?? null };
}

test("splitHostPort parses IPv4, hostnames and bracketed IPv6, rejecting malformed authorities", () => {
  assert.deepEqual(splitHostPort("127.0.0.1:443"), { host: "127.0.0.1", port: 443 });
  assert.deepEqual(splitHostPort("chat.example:8080"), { host: "chat.example", port: 8080 });
  assert.deepEqual(splitHostPort("[::1]:9"), { host: "::1", port: 9 });
  for (const bad of ["::1:9", "host", "host:0", "host:65536", "[::1]", ""]) assert.equal(splitHostPort(bad), null, bad);
});

test("origin serves generate_204, cross-origin 302, cacheable and records each hit", async (t) => {
  const origin = await startOrigin();
  t.after(() => origin.close());
  const direct = async (path: string, init: RequestInit = {}) => {
    const res = await fetch(`${origin.url}${path}`, { redirect: "manual", ...init });
    await res.arrayBuffer();
    return res;
  };
  assert.equal((await direct("/generate_204")).status, 204);
  const redirect = await direct(`/redirect?to=${encodeURIComponent("http://other.example/next")}`);
  assert.equal(redirect.status, 302);
  assert.equal(redirect.headers.get("location"), "http://other.example/next");
  assert.equal(origin.redirectTo("http://x.example/a?b=1"), `${origin.url}/redirect?to=${encodeURIComponent("http://x.example/a?b=1")}`);
  assert.equal((await direct("/redirect")).status, 400);
  assert.equal((await direct("/cacheable")).headers.get("cache-control"), "public, max-age=3600");
  assert.equal((await direct("/anything")).status, 200);
  await direct("/upload", { method: "POST", body: new Uint8Array(5 * 1024 * 1024), headers: { authorization: "Bearer t" } });
  assert.deepEqual(origin.hits.map((hit) => hit.path), [
    "/generate_204", `/redirect?to=${encodeURIComponent("http://other.example/next")}`, "/redirect", "/cacheable", "/anything", "/upload"
  ]);
  const upload = origin.hits[5];
  assert.equal(upload.method, "POST");
  assert.equal(upload.authorization, "Bearer t");
  assert.equal(upload.bodyBytes, 5 * 1024 * 1024);
  assert.equal(origin.hits[0].authorization, null);
  assert.equal(origin.hits[0].cookie, null);
});

test("origin slow-body sends headers and a first chunk but never finishes until close", async () => {
  const origin = await startOrigin();
  const raw = await openRaw(origin.port);
  raw.write(innerGet("/slow-body", "127.0.0.1"));
  assert.match(await raw.head(), /^HTTP\/1\.1 200 /);
  assert.equal(raw.isClosed(), false);
  await origin.close();
  await raw.rest();
  assert.equal(raw.isClosed(), true, "close() 必须销毁未结束的响应连接");
});

test("HTTP proxy forwards absolute-URI requests and logs proxy-side resolution", async (t) => {
  const origin = await startOrigin();
  const proxy = await startHttpProxy({ hosts: { [ORIGIN_HOST]: "127.0.0.1" } });
  t.after(async () => { await proxy.close(); await origin.close(); });
  assert.equal((await proxiedGet(proxy.port, `${origin.url}/generate_204`)).status, 204);
  assert.equal((await proxiedGet(proxy.port, `http://${ORIGIN_HOST}:${origin.port}/mapped`)).status, 200);
  assert.deepEqual(proxy.log, [
    { kind: "http", target: `${origin.url}/generate_204`, resolvedBy: "proxy", authorized: true },
    { kind: "http", target: `http://${ORIGIN_HOST}:${origin.port}/mapped`, resolvedBy: "proxy", authorized: true }
  ]);
  assert.deepEqual(origin.hits.map((hit) => hit.path), ["/generate_204", "/mapped"]);
});

test("HTTP proxy CONNECT tunnels bytes to the target and logs the authority", async (t) => {
  const origin = await startOrigin();
  const proxy = await startHttpProxy();
  t.after(async () => { await proxy.close(); await origin.close(); });
  const raw = await openRaw(proxy.port);
  raw.write(`CONNECT 127.0.0.1:${origin.port} HTTP/1.1\r\nHost: 127.0.0.1:${origin.port}\r\n\r\n`);
  assert.match(await raw.head(), /^HTTP\/1\.1 200 /);
  raw.write(innerGet("/tunnel", "127.0.0.1"));
  assert.match(await raw.rest(), /^HTTP\/1\.1 200 [\s\S]*\r\n\r\nok$/);
  assert.deepEqual(proxy.log, [{ kind: "connect", target: `127.0.0.1:${origin.port}`, resolvedBy: "proxy", authorized: true }]);
  assert.deepEqual(origin.hits.map((hit) => [hit.path, hit.authorization]), [["/tunnel", "Bearer inner"]]);
});

test("HTTP proxy CONNECT to an unreachable target answers 502 instead of hanging", async (t) => {
  const proxy = await startHttpProxy();
  t.after(() => proxy.close());
  const raw = await openRaw(proxy.port);
  raw.write("CONNECT 127.0.0.1:9 HTTP/1.1\r\nHost: 127.0.0.1:9\r\n\r\n");
  assert.match(await raw.rest(), /^HTTP\/1\.1 502 /);
});

test("authenticated HTTP proxy answers 407 with the Basic realm for missing or wrong credentials", async (t) => {
  const origin = await startOrigin();
  const proxy = await startHttpProxy({ auth: { username: "alice", password: "s3cret" } });
  t.after(async () => { await proxy.close(); await origin.close(); });
  const missing = await proxiedGet(proxy.port, `${origin.url}/a`);
  assert.deepEqual(missing, { status: 407, proxyAuthenticate: 'Basic realm="polyask-test"' });
  const wrong = await proxiedGet(proxy.port, `${origin.url}/b`, { "Proxy-Authorization": basic("alice", "nope") });
  assert.equal(wrong.status, 407);
  const right = await proxiedGet(proxy.port, `${origin.url}/c`, { "Proxy-Authorization": basic("alice", "s3cret") });
  assert.equal(right.status, 200);

  const rejected = await openRaw(proxy.port);
  rejected.write(`CONNECT 127.0.0.1:${origin.port} HTTP/1.1\r\nHost: x\r\nProxy-Authorization: ${basic("bob", "s3cret")}\r\n\r\n`);
  const reply = await rejected.rest();
  assert.match(reply, /^HTTP\/1\.1 407 /);
  assert.match(reply, /\r\nProxy-Authenticate: Basic realm="polyask-test"\r\n/);
  const accepted = await openRaw(proxy.port);
  accepted.write(`CONNECT 127.0.0.1:${origin.port} HTTP/1.1\r\nHost: x\r\nProxy-Authorization: ${basic("alice", "s3cret")}\r\n\r\n`);
  assert.match(await accepted.head(), /^HTTP\/1\.1 200 /);
  accepted.destroy();

  assert.deepEqual(proxy.log.map((entry) => [entry.kind, entry.authorized]), [
    ["http", false], ["http", false], ["http", true], ["connect", false], ["connect", true]
  ]);
  assert.deepEqual(origin.hits.map((hit) => hit.path), ["/c"], "407 的请求不得到达源站");
});

test("SOCKS5 tunnels domain targets resolved by the proxy and IPv4 targets resolved by the client", async (t) => {
  const origin = await startOrigin();
  const proxy = await startSocksProxy({ version: 5, hosts: { [ORIGIN_HOST]: "127.0.0.1" } });
  t.after(async () => { await proxy.close(); await origin.close(); });
  const port = [origin.port >> 8, origin.port & 0xff];

  const byName = await openRaw(proxy.port);
  byName.write(Buffer.from([5, 1, 0]));
  assert.deepEqual(await byName.read(2), [5, 0]);
  byName.write(Buffer.from([5, 1, 0, 3, ORIGIN_HOST.length, ...Buffer.from(ORIGIN_HOST), ...port]));
  assert.deepEqual((await byName.read(10)).slice(0, 2), [5, 0]);
  byName.write(innerGet("/socks5-name", ORIGIN_HOST));
  assert.match(await byName.rest(), /^HTTP\/1\.1 200 /);

  const byIp = await openRaw(proxy.port);
  byIp.write(Buffer.from([5, 2, 2, 0]));
  assert.deepEqual(await byIp.read(2), [5, 0]);
  byIp.write(Buffer.from([5, 1, 0, 1, 127, 0, 0, 1, ...port]));
  assert.deepEqual((await byIp.read(10)).slice(0, 2), [5, 0]);
  byIp.write(innerGet("/socks5-ip", "127.0.0.1"));
  assert.match(await byIp.rest(), /^HTTP\/1\.1 200 /);

  assert.deepEqual(proxy.log, [
    { kind: "socks5", target: `${ORIGIN_HOST}:${origin.port}`, resolvedBy: "proxy", authorized: true },
    { kind: "socks5", target: `127.0.0.1:${origin.port}`, resolvedBy: "client", authorized: true }
  ]);
  assert.deepEqual(proxy.methods, [[0], [2, 0]]);
  assert.deepEqual(origin.hits.map((hit) => hit.path), ["/socks5-name", "/socks5-ip"]);
});

test("SOCKS5 refuses clients that only offer username/password auth and never logs a target", async (t) => {
  const proxy = await startSocksProxy({ version: 5 });
  t.after(() => proxy.close());
  const raw = await openRaw(proxy.port);
  raw.write(Buffer.from([5, 1, 2]));
  assert.deepEqual(await raw.read(2), [5, 0xff]);
  await raw.rest();
  assert.equal(raw.isClosed(), true);
  assert.deepEqual(proxy.methods, [[2]]);
  assert.deepEqual(proxy.log, []);
});

test("SOCKS5 reports a failed CONNECT to an unreachable target", async (t) => {
  const proxy = await startSocksProxy({ version: 5 });
  t.after(() => proxy.close());
  const raw = await openRaw(proxy.port);
  raw.write(Buffer.from([5, 1, 0]));
  await raw.read(2);
  raw.write(Buffer.from([5, 1, 0, 1, 127, 0, 0, 1, 0, 9]));
  assert.deepEqual((await raw.read(2)), [5, 1]);
});

test("SOCKS4 resolves on the client, SOCKS4a hands the hostname to the proxy", async (t) => {
  const origin = await startOrigin();
  const proxy = await startSocksProxy({ version: 4, hosts: { [ORIGIN_HOST]: "127.0.0.1" } });
  t.after(async () => { await proxy.close(); await origin.close(); });
  const port = [origin.port >> 8, origin.port & 0xff];

  const v4 = await openRaw(proxy.port);
  v4.write(Buffer.from([4, 1, ...port, 127, 0, 0, 1, ...Buffer.from("user"), 0]));
  assert.deepEqual((await v4.read(8)).slice(0, 2), [0, 0x5a]);
  v4.write(innerGet("/socks4", "127.0.0.1"));
  assert.match(await v4.rest(), /^HTTP\/1\.1 200 /);

  const v4a = await openRaw(proxy.port);
  v4a.write(Buffer.from([4, 1, ...port, 0, 0, 0, 1, 0, ...Buffer.from(ORIGIN_HOST), 0]));
  assert.deepEqual((await v4a.read(8)).slice(0, 2), [0, 0x5a]);
  v4a.write(innerGet("/socks4a", ORIGIN_HOST));
  assert.match(await v4a.rest(), /^HTTP\/1\.1 200 /);

  assert.deepEqual(proxy.log, [
    { kind: "socks4", target: `127.0.0.1:${origin.port}`, resolvedBy: "client", authorized: true },
    { kind: "socks4", target: `${ORIGIN_HOST}:${origin.port}`, resolvedBy: "proxy", authorized: true }
  ]);
  assert.deepEqual(origin.hits.map((hit) => hit.path), ["/socks4", "/socks4a"]);
});

test("a SOCKS server drops greetings of the other protocol version without logging", async (t) => {
  const v5 = await startSocksProxy({ version: 5 });
  const v4 = await startSocksProxy({ version: 4 });
  t.after(async () => { await v5.close(); await v4.close(); });
  const toV5 = await openRaw(v5.port);
  toV5.write(Buffer.from([4, 1, 0, 80, 127, 0, 0, 1, 0]));
  await toV5.rest();
  const toV4 = await openRaw(v4.port);
  toV4.write(Buffer.from([5, 1, 0, 0, 0, 0, 0, 0]));
  await toV4.rest();
  assert.equal(toV5.isClosed() && toV4.isClosed(), true);
  assert.deepEqual([v5.log.length, v4.log.length, v5.methods.length], [0, 0, 0]);
});

test("close() resolves while a CONNECT tunnel is still open and frees the port", async () => {
  const origin = await startOrigin();
  const proxy = await startHttpProxy();
  const raw = await openRaw(proxy.port);
  raw.write(`CONNECT 127.0.0.1:${origin.port} HTTP/1.1\r\nHost: x\r\n\r\n`);
  assert.match(await raw.head(), /^HTTP\/1\.1 200 /);
  await proxy.close();
  await origin.close();
  await raw.rest();
  assert.equal(raw.isClosed(), true);
  await assert.rejects(openRaw(proxy.port), { code: "ECONNREFUSED" });
});
