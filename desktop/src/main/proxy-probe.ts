import type { AuthInfo, ProxyConfig, Session } from "electron";

import {
  PROXY_CHECK_URL, checkProxyInput, expectedResolve, proxyIdentity, proxyPasswordProblem, type ProxyIdentity, type ProxyPreference
} from "../shared/proxy-preference";
import type { RequestLoginHandler } from "./net-request-fetch";
import { PROXY_SECRET_READ_TIMEOUT_MS, decodeProxySecret, normalizeProxyHost, sameProxyIdentity, type ProxyAuth } from "./proxy-auth";
import { isProxyNetError } from "./proxy-net-error";
import type { SecretFileStore } from "./secret-file-store";

// 设置卡「测试连接」（spec §6.3）：独立的 probe session，每次测试前清干净，按表单值配置并校验，
// 再经 net.request 适配器请求 generate_204。不受 OperationGate 限制，同一时间只跑一个测试。
// 只返回 result 枚举，不产出 code 字面量，也不产出用户可见文案。

export const PROBE_URL = "https://www.gstatic.com/generate_204";
export const PROBE_TIMEOUT_MS = 8_000;
/** 与 applyConfig 第 3 步相同：setProxy resolve 之后，resolveProxy 不符时有界重试，总时长不超过 2s。 */
export const PROBE_VERIFY_WINDOW_MS = 2_000;
/** 与 proxy-runtime 的 PROXY_CHROMIUM_CALL_TIMEOUT_MS 同值：probe session 上每个 Chromium 调用都有界。 */
export const PROBE_CALL_TIMEOUT_MS = 5_000;
const VERIFY_INTERVAL_MS = 100;

export type ProbeFailure =
  | "proxy_invalid" | "proxy_failed" | "proxy_auth_failed" | "network_error" | "network_timeout"
  | "proxy_apply_failed" | "proxy_test_busy";
export type ProbeResult =
  | { readonly ok: true; readonly ms: number; readonly route: "proxy" | "direct" }
  | { readonly ok: false; readonly result: ProbeFailure };
/** 按规范化身份查已存密码；查不到、身份不一致、本次运行已清除时返回 null。 */
export type StoredPasswordReader = (identity: ProxyIdentity) => Promise<string | null>;

export interface ProxyProbeOptions {
  /** 生产传 `() => session.fromPartition(PROBE_PARTITION)`。 */
  readonly session: () => Session;
  /** 生产传 `(s, onLogin) => createSessionFetch(s, { onLogin })`；onLogin 是本次测试专用的请求级 login。 */
  readonly fetchFor: (session: Session, onLogin: RequestLoginHandler) => typeof fetch;
  /** 生产传 `toProxyConfig`，与 runtime 用同一份翻译。 */
  readonly translate: (value: ProxyPreference) => ProxyConfig;
  /** 表单没填新密码时，在身份一致的前提下取已存密码；缺省 = 不用已存密码。 */
  readonly storedPassword?: StoredPasswordReader;
  readonly timeoutMs?: number;
  readonly verifyWindowMs?: number;
  readonly callTimeoutMs?: number;
  readonly now?: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
}

const failure = (result: ProbeFailure): ProbeResult => ({ ok: false, result });

const AUTH_ERROR = /^net::ERR_PROXY_AUTH_(REQUESTED|UNSUPPORTED)\b/;
const TIMEOUT_ERROR = /^net::ERR_(TIMED_OUT|CONNECTION_TIMED_OUT)\b/;

function errorField(error: unknown, key: "name" | "message"): string {
  const value = error !== null && typeof error === "object" ? (error as Record<string, unknown>)[key] : undefined;
  return typeof value === "string" ? value : "";
}

/** 适配器的 reject：超时是 TimeoutError（signal.reason），网络失败的 message 是 Chromium 原样错误名。 */
export function classifyProbeError(error: unknown, authRejected: boolean): ProbeFailure {
  if (errorField(error, "name") === "TimeoutError") return "network_timeout";
  const message = errorField(error, "message");
  // 隧道上取消 407 时 Chromium 报的未必是 AUTH 类错误名，所以本次测试拒绝过认证就按认证失败归类。
  if (AUTH_ERROR.test(message) || authRejected) return "proxy_auth_failed";
  if (isProxyNetError(error)) return "proxy_failed";
  if (TIMEOUT_ERROR.test(message)) return "network_timeout";
  return "network_error";
}

/** undefined = 没填；null = 拒收（空串、超长、控制字符、非字符串，或身份不是 HTTP/HTTPS 自定义代理）。 */
function typedPassword(password: unknown, identity: ProxyIdentity | null): string | undefined | null {
  if (password === undefined) return undefined;
  if (typeof password !== "string" || !password || proxyPasswordProblem(password)) return null;
  if (!identity || identity.scheme === "socks4" || identity.scheme === "socks5") return null;
  return password;
}

function fromProxy(info: Pick<AuthInfo, "isProxy" | "host" | "port">, identity: ProxyIdentity): boolean {
  const host = normalizeProxyHost(String(info.host ?? ""));
  return info.isProxy === true && host !== null && host === normalizeProxyHost(identity.host) && Number(info.port) === identity.port;
}

/**
 * 生产用的已存密码读取：先问 ProxyAuth 的缓存（只在内存里的密码、写盘失败后的新密码、墓碑都以它为准），
 * 缓存没有结论才读盘；读取期间发生本机重置（wipeEpoch 变化）则丢弃结果，缓存有了结论则以缓存为准；
 * 身份四元组完全一致才交出密码。
 */
export function storedPasswordReader(
  store: Pick<SecretFileStore, "read">,
  auth: Pick<ProxyAuth, "credentialFor" | "wipeEpoch">
): StoredPasswordReader {
  return async (identity) => {
    const cached = auth.credentialFor(identity);
    if (cached !== undefined) return cached;
    const epoch = auth.wipeEpoch();
    const read = await store.read();
    if (auth.wipeEpoch() !== epoch) return null;
    const settled = auth.credentialFor(identity);
    if (settled !== undefined) return settled;
    const stored = read.kind === "ok" ? decodeProxySecret(read.value) : null;
    return stored && sameProxyIdentity(stored.identity, identity) ? stored.password : null;
  };
}

export class ProxyProbe {
  private inFlight: Promise<ProbeResult> | null = null;
  private readonly timeoutMs: number;
  private readonly verifyWindowMs: number;
  private readonly callTimeoutMs: number;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly opts: ProxyProbeOptions) {
    this.timeoutMs = opts.timeoutMs ?? PROBE_TIMEOUT_MS;
    this.verifyWindowMs = opts.verifyWindowMs ?? PROBE_VERIFY_WINDOW_MS;
    this.callTimeoutMs = opts.callTimeoutMs ?? PROBE_CALL_TIMEOUT_MS;
    this.now = opts.now ?? Date.now;
    this.sleep = opts.sleep ?? ((ms) => new Promise<void>((resolve) => { setTimeout(resolve, ms); }));
  }

  /** 主进程只持有一个 in-flight promise；重复调用立即返回 proxy_test_busy。 */
  test(input: unknown, password?: unknown): Promise<ProbeResult> {
    if (this.inFlight) return Promise.resolve(failure("proxy_test_busy"));
    const run = this.run(input, password)
      .catch((): ProbeResult => failure("network_error"))
      .finally(() => { this.inFlight = null; });
    this.inFlight = run;
    return run;
  }

  private async run(input: unknown, password: unknown): Promise<ProbeResult> {
    const checked = checkProxyInput(input);
    if (!checked.ok) return failure("proxy_invalid");
    const value = checked.value;
    const identity = proxyIdentity(value);
    const typed = typedPassword(password, identity);
    if (typed === null) return failure("proxy_invalid");
    const session = this.opts.session();
    let route: "proxy" | "direct";
    try {
      await this.bounded(() => session.clearAuthCache());
      await this.bounded(() => session.closeAllConnections());
      await this.bounded(() => session.clearHostResolverCache());
      await this.bounded(() => session.setProxy(this.opts.translate(value)));
      if (!(await this.verify(session, value))) return failure("proxy_apply_failed");
      route = /^\s*DIRECT\b/i.test(await this.bounded(() => session.resolveProxy(PROBE_URL))) ? "direct" : "proxy";
    } catch {
      return failure("proxy_apply_failed");
    }
    const credential = typed ?? await this.storedFor(identity);
    try {
      return await this.request(session, identity, credential, route);
    } finally {
      // 测试凭据不留在 probe session 的 HttpAuthCache 里。
      await this.bounded(() => session.clearAuthCache()).catch(() => undefined);
    }
  }

  /** Chromium 调用可能不返回：超时按失败处理，调用方统一归 proxy_apply_failed（清理阶段的失败被吞掉）。 */
  private async bounded<T>(call: () => Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        call(),
        new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error("timed_out")), this.callTimeoutMs); })
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  private async verify(session: Session, value: ProxyPreference): Promise<boolean> {
    const expected = expectedResolve(value);
    if (expected === null) return true;
    const deadline = this.now() + this.verifyWindowMs;
    for (;;) {
      if ((await this.bounded(() => session.resolveProxy(PROXY_CHECK_URL))).trim() === expected) return true;
      const left = deadline - this.now();
      if (left <= 0) return false;
      await this.sleep(Math.min(VERIFY_INTERVAL_MS, left));
    }
  }

  private async storedFor(identity: ProxyIdentity | null): Promise<string | null> {
    const reader = this.opts.storedPassword;
    if (!reader || !identity || identity.scheme === "socks4" || identity.scheme === "socks5") return null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), PROXY_SECRET_READ_TIMEOUT_MS); });
    try {
      return await Promise.race([Promise.resolve().then(() => reader(identity)).catch(() => null), timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  private async request(
    session: Session, identity: ProxyIdentity | null, credential: string | null, route: "proxy" | "direct"
  ): Promise<ProbeResult> {
    const auth = { rejected: false };
    const fetcher = this.opts.fetchFor(session, this.loginHandler(identity, credential, auth));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new DOMException("Timed out", "TimeoutError")), this.timeoutMs);
    const started = this.now();
    try {
      const response = await fetcher(PROBE_URL, { signal: controller.signal, cache: "no-store" });
      const ms = Math.max(0, Math.round(this.now() - started));
      void response.body?.cancel().catch(() => undefined);
      if (response.status === 407) return failure("proxy_auth_failed");
      if (!response.ok) return failure("network_error");
      return { ok: true, ms, route };
    } catch (error) {
      return failure(classifyProbeError(error, auth.rejected));
    } finally {
      clearTimeout(timer);
    }
  }

  /** 本次测试专用的请求级 login：不经过 app.on('login')，不计入 ProxyAuth 的熔断。 */
  private loginHandler(identity: ProxyIdentity | null, credential: string | null, auth: { rejected: boolean }): RequestLoginHandler {
    const seen = new WeakSet<object>();
    return (request, info, callback) => {
      const retry = seen.has(request);
      seen.add(request);
      if (retry || !identity || credential === null || !fromProxy(info, identity)) {
        auth.rejected = true;
        callback();
        return;
      }
      callback(identity.username, credential);
    };
  }
}
