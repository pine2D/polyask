// desktop/test/support/local-proxy.ts
// 本地代理测试服务器：只用 Node 内置模块，供代理 spike（spec §9.1）与原生检查（§9.2）复用。
// 判定依据是代理端日志（谁连了哪里、谁解析的域名、是否通过认证），不是客户端自报。
// 故意不以 .test.ts 命名：它是夹具，不注册用例。
import { once } from "node:events";
import { createServer as createHttpServer, request as httpRequest, type IncomingMessage } from "node:http";
import { connect as netConnect, createServer as createNetServer, isIP, type Server, type Socket } from "node:net";

export type ProxyLogEntry = {
  kind: "connect" | "http" | "socks4" | "socks5";
  /** connect/socks：`host:port`（IPv6 带方括号）；http：请求行里的绝对 URL。 */
  target: string;
  /** 目标域名由谁解析：HTTP 代理与 SOCKS4a/SOCKS5 域名 = proxy；SOCKS4/SOCKS5 的 IP 目标 = client。 */
  resolvedBy: "proxy" | "client";
  /** 未配置认证时恒为 true；配置后仅 `Proxy-Authorization: Basic` 正确才为 true（407 的请求也记一条 false）。 */
  authorized: boolean;
};

export type OriginHit = {
  path: string;
  authorization: string | null;
  method: string;
  cookie: string | null;
  bodyBytes: number;
};

export type HostMap = Readonly<Record<string, string>>;

type Handle = { port: number; log: ProxyLogEntry[]; close(): Promise<void> };

const PROXY_REALM = 'Basic realm="polyask-test"';
const LOOPBACK = "127.0.0.1";

/** 统一的 socket 登记：close() 时全部销毁，避免隧道/长连接拖住 server.close。 */
function socketRegistry() {
  const sockets = new Set<Socket>();
  return {
    track<T extends Socket>(socket: T): T {
      sockets.add(socket);
      socket.on("error", () => {});
      socket.once("close", () => sockets.delete(socket));
      return socket;
    },
    destroyAll() { for (const socket of sockets) socket.destroy(); sockets.clear(); }
  };
}

async function listen(server: Server): Promise<number> {
  server.listen(0, LOOPBACK);
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("local_proxy_no_port");
  return address.port;
}

function closer(server: Server, registry: ReturnType<typeof socketRegistry>) {
  return () => new Promise<void>((resolve) => {
    registry.destroyAll();
    server.close(() => resolve());
  });
}

/** `host:port` / `[v6]:port` → 拆分；端口非法返回 null。 */
export function splitHostPort(authority: string): { host: string; port: number } | null {
  const match = /^(?:\[([^\]]+)\]|([^:[\]]+)):(\d{1,5})$/.exec(authority);
  if (!match) return null;
  const port = Number(match[3]);
  if (port < 1 || port > 65535) return null;
  return { host: match[1] ?? match[2], port };
}

function formatAuthority(host: string, port: number): string {
  return isIP(host) === 6 ? `[${host}]:${port}` : `${host}:${port}`;
}

function mapHost(hosts: HostMap | undefined, host: string): string {
  return hosts?.[host.toLowerCase()] ?? host;
}

function proxyAuthorized(header: string | undefined, auth: { username: string; password: string } | undefined): boolean {
  if (!auth) return true;
  const match = /^basic\s+([A-Za-z0-9+/=]+)\s*$/i.exec(header ?? "");
  if (!match) return false;
  return Buffer.from(match[1], "base64").toString("utf8") === `${auth.username}:${auth.password}`;
}

function rawReply(status: string, extra = ""): string {
  return `HTTP/1.1 ${status}\r\n${extra}Content-Length: 0\r\nConnection: close\r\n\r\n`;
}

/** 普通 HTTP 代理：CONNECT 隧道 + 绝对 URI 转发；可选 Basic 认证（失败回 407）。 */
export async function startHttpProxy(opts: {
  auth?: { username: string; password: string };
  /** 代理端解析表（小写主机名 → 实际连接地址），让原生检查用非 loopback 主机名绕开 Chromium 的 loopback 隐式直连。 */
  hosts?: HostMap;
} = {}): Promise<Handle> {
  const log: ProxyLogEntry[] = [];
  const registry = socketRegistry();
  const server = createHttpServer();
  server.on("connection", (socket: Socket) => registry.track(socket));

  server.on("request", (req: IncomingMessage, res) => {
    let url: URL;
    try { url = new URL(req.url ?? ""); } catch { res.writeHead(400, { Connection: "close" }).end(); return; }
    if (url.protocol !== "http:") { res.writeHead(400, { Connection: "close" }).end(); return; }
    const authorized = proxyAuthorized(req.headers["proxy-authorization"], opts.auth);
    log.push({ kind: "http", target: url.href, resolvedBy: "proxy", authorized });
    if (!authorized) {
      res.writeHead(407, { "Proxy-Authenticate": PROXY_REALM, "Content-Length": "0" }).end();
      return;
    }
    const headers = { ...req.headers };
    delete headers["proxy-authorization"];
    delete headers["proxy-connection"];
    const host = url.hostname.replace(/^\[|\]$/g, "");
    const upstream = httpRequest({
      host: mapHost(opts.hosts, host), port: Number(url.port || 80), method: req.method,
      path: `${url.pathname}${url.search}`, headers, agent: false
    }, (reply) => {
      reply.on("error", () => res.destroy());
      res.writeHead(reply.statusCode ?? 502, reply.headers);
      reply.pipe(res);
    });
    upstream.on("socket", (socket) => registry.track(socket));
    upstream.on("error", () => { if (!res.headersSent) res.writeHead(502, { Connection: "close" }); res.end(); });
    req.on("error", () => upstream.destroy()); // 客户端中途 abort 不得让夹具进程抛未处理 error
    req.pipe(upstream);
  });

  server.on("connect", (req: IncomingMessage, client: Socket, head: Buffer) => {
    registry.track(client).pause(); // 隧道建立前不读：pipe 时再恢复，避免无监听的流动模式丢字节
    const target = req.url ?? "";
    const authorized = proxyAuthorized(req.headers["proxy-authorization"], opts.auth);
    log.push({ kind: "connect", target, resolvedBy: "proxy", authorized });
    if (!authorized) { client.end(rawReply("407 Proxy Authentication Required", `Proxy-Authenticate: ${PROXY_REALM}\r\n`)); return; }
    const parsed = splitHostPort(target);
    if (!parsed) { client.end(rawReply("400 Bad Request")); return; }
    let established = false;
    const upstream = registry.track(netConnect(parsed.port, mapHost(opts.hosts, parsed.host)));
    upstream.once("connect", () => {
      established = true;
      client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head.length) upstream.write(head);
      upstream.pipe(client);
      client.pipe(upstream);
    });
    upstream.once("error", () => { if (established) client.destroy(); else client.end(rawReply("502 Bad Gateway")); });
    client.once("close", () => upstream.destroy());
  });

  const port = await listen(server);
  return { port, log, close: closer(server, registry) };
}

/** 按需读取的 socket 缓冲：握手阶段逐帧解析，release 后把余量交还给隧道。 */
function socketReader(socket: Socket) {
  let buffered = Buffer.alloc(0);
  let ended = false;
  let wake: (() => void) | null = null;
  const notify = () => { const fn = wake; wake = null; fn?.(); };
  const onData = (chunk: Buffer) => { buffered = Buffer.concat([buffered, chunk]); notify(); };
  const onEnd = () => { ended = true; notify(); };
  socket.on("data", onData);
  socket.on("end", onEnd);
  socket.on("close", onEnd);
  const more = async () => {
    if (ended) throw new Error("local_proxy_eof");
    await new Promise<void>((resolve) => { wake = resolve; });
  };
  return {
    async take(n: number): Promise<Buffer> {
      while (buffered.length < n) await more();
      const out = buffered.subarray(0, n);
      buffered = buffered.subarray(n);
      return out;
    },
    async takeCString(max = 1024): Promise<string> {
      for (;;) {
        const index = buffered.indexOf(0);
        if (index >= 0) {
          const out = buffered.subarray(0, index).toString("latin1");
          buffered = buffered.subarray(index + 1);
          return out;
        }
        if (buffered.length > max) throw new Error("local_proxy_cstring_too_long");
        await more();
      }
    },
    /** 停止握手解析：先 pause，避免移除 data 监听后流动模式把字节丢掉。 */
    release(): Buffer {
      socket.pause();
      socket.off("data", onData);
      socket.off("end", onEnd);
      socket.off("close", onEnd);
      return buffered;
    }
  };
}

function tunnel(registry: ReturnType<typeof socketRegistry>, client: Socket, leftover: Buffer, host: string, port: number,
  reply: (ok: boolean) => Buffer): void {
  const upstream = registry.track(netConnect(port, host));
  let established = false;
  upstream.once("connect", () => {
    established = true;
    client.write(reply(true));
    if (leftover.length) upstream.write(leftover);
    upstream.pipe(client);
    client.pipe(upstream);
  });
  upstream.once("error", () => {
    if (client.destroyed) return;
    if (established) client.destroy(); else client.end(reply(false));
  });
  client.once("close", () => upstream.destroy());
}

async function handleSocks4(client: Socket, reader: ReturnType<typeof socketReader>, log: ProxyLogEntry[],
  registry: ReturnType<typeof socketRegistry>, hosts: HostMap | undefined): Promise<void> {
  const first = await reader.take(1);
  if (first[0] !== 4) { client.destroy(); return; }
  const header = Buffer.concat([first, await reader.take(7)]);
  const port = header.readUInt16BE(2);
  const ip = [...header.subarray(4, 8)].join(".");
  await reader.takeCString(); // USERID：本服务不校验
  // SOCKS4a：DSTIP = 0.0.0.x（x≠0）时，USERID 之后跟一个由代理解析的域名。
  const isSocks4a = header[4] === 0 && header[5] === 0 && header[6] === 0 && header[7] !== 0;
  const host = isSocks4a ? await reader.takeCString(255) : ip;
  log.push({ kind: "socks4", target: formatAuthority(host, port), resolvedBy: isSocks4a ? "proxy" : "client", authorized: true });
  const reply = (ok: boolean) => Buffer.from([0, ok ? 0x5a : 0x5b, 0, 0, 0, 0, 0, 0]);
  if (header[1] !== 1) { client.end(reply(false)); return; }
  tunnel(registry, client, reader.release(), mapHost(hosts, host), port, reply);
}

async function handleSocks5(client: Socket, reader: ReturnType<typeof socketReader>, log: ProxyLogEntry[],
  registry: ReturnType<typeof socketRegistry>, hosts: HostMap | undefined, methods: number[][]): Promise<void> {
  const greeting = await reader.take(2);
  if (greeting[0] !== 5) { client.destroy(); return; }
  const offered = [...await reader.take(greeting[1])];
  methods.push(offered);
  if (!offered.includes(0)) { client.end(Buffer.from([5, 0xff])); return; }
  client.write(Buffer.from([5, 0]));
  const request = await reader.take(4);
  let host: string;
  if (request[3] === 1) host = [...await reader.take(4)].join(".");
  else if (request[3] === 3) host = (await reader.take((await reader.take(1))[0])).toString("latin1");
  else if (request[3] === 4) {
    const raw = await reader.take(16);
    host = Array.from({ length: 8 }, (_, i) => raw.readUInt16BE(i * 2).toString(16)).join(":");
  } else { client.destroy(); return; }
  const port = (await reader.take(2)).readUInt16BE(0);
  log.push({ kind: "socks5", target: formatAuthority(host, port), resolvedBy: request[3] === 3 ? "proxy" : "client", authorized: true });
  const reply = (code: number) => Buffer.from([5, code, 0, 1, 0, 0, 0, 0, 0, 0]);
  if (request[1] !== 1) { client.end(reply(0x07)); return; }
  tunnel(registry, client, reader.release(), mapHost(hosts, host), port, (ok) => reply(ok ? 0 : 0x01));
}

/** SOCKS4（含 4a）/ SOCKS5 无认证 CONNECT。`methods` 记录每次 SOCKS5 握手客户端提供的认证方法。 */
export async function startSocksProxy(opts: { version: 4 | 5; hosts?: HostMap }): Promise<Handle & { methods: number[][] }> {
  const log: ProxyLogEntry[] = [];
  const methods: number[][] = [];
  const registry = socketRegistry();
  const server = createNetServer((client) => {
    registry.track(client);
    const reader = socketReader(client);
    const handshake = opts.version === 4
      ? handleSocks4(client, reader, log, registry, opts.hosts)
      : handleSocks5(client, reader, log, registry, opts.hosts, methods);
    handshake.catch(() => client.destroy());
  });
  const port = await listen(server);
  return { port, log, methods, close: closer(server, registry) };
}

/** 本地 HTTP 源站：/generate_204、/redirect?to=、/cacheable、/slow-body，其余 200 "ok"；逐请求记录。 */
export async function startOrigin(): Promise<{
  port: number; url: string; hits: OriginHit[]; close(): Promise<void>; redirectTo(target: string): string;
}> {
  const hits: OriginHit[] = [];
  const registry = socketRegistry();
  const server = createHttpServer((req, res) => {
    const hit: OriginHit = {
      path: req.url ?? "/", authorization: req.headers.authorization ?? null,
      method: req.method ?? "GET", cookie: req.headers.cookie ?? null, bodyBytes: 0
    };
    hits.push(hit);
    req.on("error", () => {}); // 上传中途 abort（spike §9.1-a）只留下 bodyBytes 的部分计数
    req.on("data", (chunk: Buffer) => { hit.bodyBytes += chunk.length; });
    req.on("end", () => {
      const url = new URL(req.url ?? "/", "http://origin.invalid");
      if (url.pathname === "/generate_204") { res.writeHead(204).end(); return; }
      if (url.pathname === "/redirect") {
        const to = url.searchParams.get("to");
        if (!to) { res.writeHead(400).end(); return; }
        res.writeHead(302, { Location: to, "Content-Length": "0" }).end();
        return;
      }
      if (url.pathname === "/cacheable") {
        res.writeHead(200, { "Content-Type": "text/plain", "Content-Length": "9", "Cache-Control": "public, max-age=3600" }).end("cacheable");
        return;
      }
      if (url.pathname === "/slow-body") {
        // 只发首块、不结束：供 body 读取阶段 abort 的验证；close() 时随 socket 一起销毁。
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.write("partial");
        return;
      }
      res.writeHead(200, { "Content-Type": "text/plain", "Content-Length": "2" }).end("ok");
    });
  });
  server.on("connection", (socket: Socket) => registry.track(socket));
  const port = await listen(server);
  const url = `http://${LOOPBACK}:${port}`;
  return {
    port, url, hits, close: closer(server, registry),
    redirectTo: (target: string) => `${url}/redirect?to=${encodeURIComponent(target)}`
  };
}
