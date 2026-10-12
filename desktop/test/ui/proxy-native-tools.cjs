// 原生代理检查的辅助服务（只用 Node 内置模块）：T1 不提供的 TLS 源站与 CONNECT 改写前置，外加偏好构造与轮询。
// 测试连接的目标写死为 https://www.gstatic.com/generate_204（spec §6.3），本机不能监听 443；
// 前置只改写 CONNECT 请求行里的目标，407、认证与日志仍由它背后的 T1 代理完成。
const http = require('node:http');
const https = require('node:https');
const net = require('node:net');
const { once } = require('node:events');

const ORIGIN_HOST = 'origin.polyask.test';
const USERNAME = 'polyask';
const PASSWORD = 'secret-1';
/** Review Focus 5：同时含 `@`、`:` 与非 ASCII；任何 URL 编码、按冒号截断或 Latin-1 转码都会让代理拒绝。 */
const UNICODE_PASSWORD = 'p@ss:w\u00f6rd'; // p@ss:wörd，用转义写死预组合的 ö（U+00F6），不受编辑器 NFC/NFD 影响

async function listen(server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return server.address().port;
}

/** close() 先销毁全部已接入 socket，长连接与隧道不会拖住 server.close。 */
function tracked(server) {
  const sockets = new Set();
  server.on('connection', socket => {
    sockets.add(socket);
    socket.on('error', () => {});
    socket.once('close', () => sockets.delete(socket));
  });
  return () => new Promise(resolve => {
    for (const socket of sockets) socket.destroy();
    server.close(() => resolve());
  });
}

/** 本地 HTTPS 源站：只认 /generate_204，记录每次命中的路径。 */
async function startTlsOrigin({ key, cert }) {
  const hits = [];
  const server = https.createServer({ key, cert }, (request, response) => {
    hits.push(request.url);
    if (request.url === '/generate_204') response.writeHead(204);
    else response.writeHead(404, { 'Content-Length': '0' });
    response.end();
  });
  const close = tracked(server);
  return { port: await listen(server), hits, close };
}

/** CONNECT 改写前置：读完请求头，按表替换请求行里的目标，其余字节原样转给上游代理后双向直通。 */
async function startConnectRewriter(upstreamPort, rewrites) {
  const rewritten = [];
  const server = net.createServer(client => {
    let head = Buffer.alloc(0);
    const onData = chunk => {
      head = Buffer.concat([head, chunk]);
      const end = head.indexOf('\r\n\r\n');
      if (end < 0) { if (head.length > 16384) client.destroy(); return; }
      client.pause();
      client.off('data', onData);
      const text = head.subarray(0, end).toString('latin1');
      const match = /^CONNECT (\S+) HTTP\/1\.[01]\r\n/.exec(text);
      const target = match ? rewrites[match[1]] : undefined;
      if (target) rewritten.push(match[1]);
      const forwarded = target ? text.replace(match[1], target) : text;
      const upstream = net.connect(upstreamPort, '127.0.0.1');
      upstream.on('error', () => client.destroy());
      client.once('close', () => upstream.destroy());
      upstream.once('connect', () => {
        upstream.write(Buffer.concat([Buffer.from(forwarded, 'latin1'), head.subarray(end)]));
        upstream.pipe(client);
        client.pipe(upstream);
        client.resume();
      });
    };
    client.on('data', onData);
  });
  const close = tracked(server);
  return { port: await listen(server), rewritten, close };
}

/** 取一个刚释放的本机端口：模拟「已保存的代理没在运行」（如 Clash 未启动），连接会被立即拒绝。 */
async function closedPort() {
  const server = net.createServer();
  const port = await listen(server);
  await new Promise(resolve => server.close(() => resolve()));
  return port;
}

/** 按指定字节编码拼 Basic 凭据：对照组用 latin1 / URL 编码，证明 T1 夹具按 UTF-8 严格比对。 */
function basic(username, password, encoding = 'utf8') {
  return `Basic ${Buffer.from(`${username}:${password}`, encoding).toString('base64')}`;
}

/** 绕过 Chromium 直接问代理：带指定 Proxy-Authorization 的绝对 URI 请求，返回状态码。 */
function proxyStatus(port, url, authorization) {
  return new Promise((resolve, reject) => {
    const request = http.request({ host: '127.0.0.1', port, method: 'GET', path: url, agent: false,
      headers: { 'Proxy-Authorization': authorization } }, response => {
      response.resume();
      response.once('end', () => resolve(response.statusCode));
    });
    request.once('error', reject);
    request.end();
  });
}

/** 规范形式的代理偏好（字段顺序与 normalizeProxyPreference 一致）。 */
function preference(mode, fields = {}) {
  return { version: 1, mode, scheme: 'http', host: '', port: 0, bypass: [], username: '', ...fields };
}
function custom(port, fields = {}) {
  return preference('custom', { host: '127.0.0.1', port, ...fields });
}

async function waitFor(check, label, ms = 5000) {
  const end = Date.now() + ms;
  while (!(await check())) {
    if (Date.now() > end) throw new Error(`Timeout: ${label}`);
    await new Promise(resolve => setTimeout(resolve, 25));
  }
}

const samePem = (left, right) => String(left).replace(/\s+/g, '') === String(right).replace(/\s+/g, '');

module.exports = {
  ORIGIN_HOST, USERNAME, PASSWORD, UNICODE_PASSWORD, startTlsOrigin, startConnectRewriter, closedPort, basic, proxyStatus,
  preference, custom, waitFor, samePem
};
