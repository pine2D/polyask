// desktop/scripts/lib/dev-tour-client.mjs — 开发态真机巡检与烟雾测试共用的本地 CDP 连接与安全门禁。
// 铁律：只连 127.0.0.1 / localhost 调试端口；启动前先验开发运行时 Cookie 加密 Fuse；不回传对话正文与完整 URL。
import { createHash } from 'node:crypto';
import { createReadStream, readFileSync } from 'node:fs';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, join, normalize, relative as pathRelative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mainFrameProbeContext } from './measure-site-probe.mjs';
import { linuxBoundary } from '../test-safe.mjs';

const require = createRequire(import.meta.url);
const { FuseV1Options, FuseVersion, getCurrentFuseWire } = require('@electron/fuses');
const { SENTINEL } = require('@electron/fuses/dist/constants');
const { desktopSites } = require('./desktop-anchors.js');

const DESKTOP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

export function readSiteDefinitions() {
  const source = readFileSync(join(DESKTOP_ROOT, 'src/main/sites.ts'), 'utf8');
  return desktopSites().map((base) => {
    const lineRe = new RegExp(`\\{\\s*key:\\s*"${base.key}"[^\\n]*\\}`);
    const row = source.match(lineRe)?.[0] || '';
    const authMatch = row.match(/authHosts:\s*\[([^\]]*)\]/);
    const authHosts = authMatch
      ? [...authMatch[1].matchAll(/"([^"]+)"/g)].map((m) => m[1])
      : [];
    const imageMatch = row.match(/\bimage:\s*(true|false)\b/);
    return {
      ...base,
      authHosts,
      image: imageMatch ? imageMatch[1] === 'true' : true
    };
  });
}
const ENABLED_FUSE = 0x31;
const MARKER_FILE = '.polyask-dev-runtime.json';
const DATA_MAX_BYTES = 2 * 1024 ** 3;
const HEAP_FLAG = '--max-old-space-size=1024';

function fail(code, detail = '') {
  const err = new Error(detail ? `${code}:${detail}` : code);
  err.code = code;
  return err;
}

function fuseBinaryPath(executable) {
  if (executable.endsWith('.app')) {
    return join(executable, 'Contents/Frameworks/Electron Framework.framework/Electron Framework');
  }
  return executable.includes('.app')
    ? resolve(executable, '../../Frameworks/Electron Framework.framework/Electron Framework')
    : executable;
}

async function sha256File(filePath) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest('hex');
}

async function allCookieFuseStates(executable) {
  const bytes = await readFile(fuseBinaryPath(executable));
  const states = [];
  for (let idx = bytes.indexOf(SENTINEL); idx !== -1; idx = bytes.indexOf(SENTINEL, idx + SENTINEL.length)) {
    const offset = idx + SENTINEL.length;
    const length = bytes[offset + 1];
    if (bytes[offset] !== Number(FuseVersion.V1) || length <= FuseV1Options.EnableCookieEncryption || offset + 2 + length > bytes.length) {
      throw fail('dev_cookie_encryption_unverified');
    }
    states.push(bytes[offset + 2 + FuseV1Options.EnableCookieEncryption]);
  }
  if (!states.length) throw fail('dev_cookie_encryption_unverified');
  return states;
}

export async function verifyDevRuntimeCookieEncryption(desktopRoot = DESKTOP_ROOT, env = process.env) {
  const root = await realpath(desktopRoot);
  const localRequire = createRequire(join(root, 'package.json'));
  const pkgPath = localRequire.resolve('electron/package.json');
  const { version } = JSON.parse(await readFile(pkgPath, 'utf8'));
  const relative = (await readFile(resolve(pkgPath, '../path.txt'), 'utf8')).trim();
  if (!relative || isAbsolute(relative) || normalize(relative).split(sep).includes('..')) {
    throw fail('dev_runtime_path_unverified');
  }
  const dist = env.ELECTRON_OVERRIDE_DIST_PATH
    ? resolve(env.ELECTRON_OVERRIDE_DIST_PATH)
    : join(root, 'test-artifacts', 'dev-runtime', `${version}-${process.platform}-${process.arch}`);
  let distReal;
  try {
    const info = await lstat(dist);
    if (!info.isDirectory() || info.isSymbolicLink()) throw fail('dev_runtime_directory_untrusted');
    distReal = await realpath(dist);
  } catch (err) {
    if (err?.code === 'ENOENT') throw fail('dev_runtime_not_prepared', 'run npm --prefix desktop run prepare:dev-runtime first');
    throw err;
  }
  const executable = join(distReal, relative);
  if (!env.ELECTRON_OVERRIDE_DIST_PATH) {
    let saved;
    try {
      const markerInfo = await lstat(join(distReal, MARKER_FILE));
      if (!markerInfo.isFile() || markerInfo.isSymbolicLink()) throw fail('dev_runtime_cache_unverified');
      saved = JSON.parse(await readFile(join(distReal, MARKER_FILE), 'utf8'));
    } catch (err) {
      if (err?.code?.startsWith?.('dev_')) throw err;
      throw fail('dev_runtime_cache_unverified');
    }
    if (saved?.schema !== 1 || saved?.version !== version || saved?.cookieEncryption !== true) {
      throw fail('dev_runtime_cache_unverified');
    }
    if (saved.digest !== await sha256File(fuseBinaryPath(executable))) {
      throw fail('dev_runtime_cache_unverified');
    }
  }
  const relExe = pathRelative(distReal, await realpath(executable));
  if (isAbsolute(relExe) || relExe === '..' || relExe.startsWith(`..${sep}`)) {
    throw fail('dev_runtime_executable_outside_copy');
  }
  let wire;
  try { wire = await getCurrentFuseWire(executable); } catch { throw fail('dev_cookie_encryption_unverified'); }
  const states = await allCookieFuseStates(executable);
  if (wire.version !== FuseVersion.V1 || wire[FuseV1Options.EnableCookieEncryption] !== ENABLED_FUSE || states.some((v) => v !== ENABLED_FUSE)) {
    throw fail('dev_cookie_encryption_required');
  }
  return { dist: distReal, executable, version };
}

export function currentProcessBoundary() {
  if (process.platform !== 'linux') return { kind: 'non-linux' };
  const read = (p) => { try { return readFileSync(p, 'utf8').trim(); } catch { return ''; } };
  const group = read('/proc/self/cgroup').split('\n').find((line) => line.startsWith('0::'))?.slice(3) ?? '';
  return linuxBoundary(
    read(`/sys/fs/cgroup${group}/memory.max`),
    read(`/sys/fs/cgroup${group}/memory.swap.max`),
    read('/proc/self/limits')
  );
}

export function reexecUnderLinuxBoundaryIfNeeded(scriptPath, rawArgs = process.argv.slice(2)) {
  if (process.platform !== 'linux') return null;
  const boundary = currentProcessBoundary();
  if (boundary) return null;
  const manager = spawnSync('systemctl', ['--user', 'show', '--property=ControlGroup', '--value'], {
    encoding: 'utf8',
    timeout: 5_000
  });
  const cmd = manager.status === 0
    ? ['systemd-run', ['--user', '--scope', '--quiet', '-p', 'MemoryMax=4G', '-p', 'MemorySwapMax=512M', process.execPath, HEAP_FLAG, scriptPath, ...rawArgs]]
    : ['prlimit', [`--data=${DATA_MAX_BYTES}:${DATA_MAX_BYTES}`, '--', process.execPath, HEAP_FLAG, scriptPath, ...rawArgs]];
  const res = spawnSync(cmd[0], cmd[1], { cwd: DESKTOP_ROOT, stdio: 'inherit', timeout: 10 * 60_000, killSignal: 'SIGKILL' });
  return res.status ?? 1;
}

export function assertLocalDebugPort(port) {
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw fail('invalid_local_debug_port', String(port));
}

export function assertLocalWsEndpoint(wsUrl, expectedPort) {
  let parsed;
  try { parsed = new URL(wsUrl); } catch { throw fail('invalid_debug_endpoint'); }
  if (parsed.protocol !== 'ws:' || !['127.0.0.1', 'localhost'].includes(parsed.hostname) || Number(parsed.port) !== expectedPort) {
    throw fail('nonlocal_debug_endpoint');
  }
  return parsed;
}

export async function openCdpTarget(wsUrl, expectedPort, WebSocketImpl = WebSocket, connectTimeoutMs = 5_000) {
  const endpoint = assertLocalWsEndpoint(wsUrl, expectedPort);
  const socket = new WebSocketImpl(endpoint);
  const pending = new Map();
  const contexts = [];
  let seq = 0;
  let closed = false;
  let closeCalled = false;

  const clearPending = (reason) => {
    for (const req of pending.values()) {
      clearTimeout(req.timer);
      req.reject(reason);
    }
    pending.clear();
  };

  const close = () => {
    closed = true;
    clearPending(fail('debug_socket_closed'));
    if (closeCalled) return;
    closeCalled = true;
    try { socket.close(); } catch { /* ignore */ }
  };

  socket.addEventListener('message', (event) => {
    const msg = JSON.parse(typeof event.data === 'string' ? event.data : String(event.data));
    if (msg.method === 'Runtime.executionContextCreated') contexts.push(msg.params.context);
    const req = pending.get(msg.id);
    if (!req) return;
    pending.delete(msg.id);
    clearTimeout(req.timer);
    if (msg.error) req.reject(fail('debug_command_failed', msg.error.message));
    else req.resolve(msg.result);
  });

  socket.addEventListener('close', () => {
    closed = true;
    clearPending(fail('debug_socket_closed'));
  });

  const call = (method, params = {}, timeoutMs = 15_000) => new Promise((resolveCall, rejectCall) => {
    if (closed) { rejectCall(fail('debug_socket_closed')); return; }
    const id = ++seq;
    const timer = setTimeout(() => {
      pending.delete(id);
      rejectCall(fail('debug_timeout', method));
    }, timeoutMs);
    pending.set(id, { resolve: resolveCall, reject: rejectCall, timer });
    socket.send(JSON.stringify({ id, method, params }));
  });

  try {
    await new Promise((resolveOpen, rejectOpen) => {
      const timer = setTimeout(() => rejectOpen(fail('debug_connect_timeout')), connectTimeoutMs);
      socket.addEventListener('open', () => { clearTimeout(timer); resolveOpen(); }, { once: true });
      socket.addEventListener('error', () => { clearTimeout(timer); rejectOpen(fail('debug_connect_failed')); }, { once: true });
      socket.addEventListener('close', () => { clearTimeout(timer); rejectOpen(fail('debug_socket_closed')); }, { once: true });
    });
    await call('Runtime.enable');
    const tree = await call('Page.getFrameTree');
    const frameId = tree?.frameTree?.frame?.id;
    const main = contexts.find((c) => c.auxData?.isDefault === true && c.auxData?.frameId === frameId);
    const isolated = mainFrameProbeContext(contexts, frameId);
    const evaluate = async (contextId, expression, options = {}) => {
      const res = await call(
        'Runtime.evaluate',
        {
          expression,
          contextId,
          returnByValue: true,
          awaitPromise: Boolean(options.awaitPromise)
        },
        options.timeoutMs ?? 20_000
      );
      if (res?.exceptionDetails) throw fail('evaluation_failed', res.exceptionDetails.text || 'exception');
      return res?.result?.value;
    };
    return { call, evaluate, mainId: main?.id ?? null, isolatedId: isolated?.id ?? null, close };
  } catch (err) {
    close();
    throw err;
  }
}

export async function listDebugTargets(port, fetchImpl = fetch) {
  assertLocalDebugPort(port);
  const res = await fetchImpl(`http://127.0.0.1:${port}/json`, { signal: AbortSignal.timeout(5_000) });
  if (!res.ok) throw fail('debug_targets_http_failed', String(res.status));
  const list = await res.json();
  if (!Array.isArray(list)) throw fail('debug_targets_invalid');
  return list;
}

export function classifySiteTarget(targets, site) {
  const siteMatches = [];
  const authMatches = [];
  for (const target of targets) {
    if (target?.type !== 'page' || typeof target.url !== 'string' || !target.webSocketDebuggerUrl) continue;
    let parsed;
    try { parsed = new URL(target.url); } catch { continue; }
    if (parsed.protocol !== 'https:') continue;
    if (parsed.hostname === site.host || parsed.hostname.endsWith(`.${site.host}`)) siteMatches.push(target);
    else if ((site.authHosts || []).some((h) => parsed.hostname === h || parsed.hostname.endsWith(`.${h}`))) authMatches.push(target);
  }
  if (siteMatches.length === 1) return { state: 'ready', target: siteMatches[0] };
  if (siteMatches.length > 1) return { state: 'ambiguous', count: siteMatches.length };
  if (authMatches.length > 0) return { state: 'sign_in', target: authMatches[0] };
  return { state: 'missing' };
}

export async function findShellSession(targets, port, openTarget = openCdpTarget) {
  for (const target of targets) {
    if (target?.type !== 'page' || !target.webSocketDebuggerUrl) continue;
    let parsed;
    try { parsed = new URL(target.url || ''); } catch { parsed = null; }
    if (parsed && parsed.protocol === 'https:') continue;
    const session = await openTarget(target.webSocketDebuggerUrl, port);
    try {
      if (session.mainId !== null) {
        const hasShell = await session.evaluate(session.mainId, 'Boolean(window.polyask && typeof window.polyask.getPreferences === "function")');
        if (hasShell === true) return session;
      }
      session.close();
    } catch {
      session.close();
    }
  }
  throw fail('shell_target_not_found');
}
