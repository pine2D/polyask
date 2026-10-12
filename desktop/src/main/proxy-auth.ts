import type { AuthenticationResponseDetails, AuthInfo } from "electron";
import {
  PROXY_SCHEMES, proxyIdentity, type ProxyIdentity, type ProxyPreference, type ProxyScheme
} from "../shared/proxy-preference";
import type { SecretFileStore, SecretReadResult, SecretWriteResult } from "./secret-file-store";

// 代理认证：只把密码交给「已应用 / 正在应用」配置里身份完全一致的代理（spec §3.6）。
// 本模块不产出用户可见文案，也不产出 code 字面量；熔断状态经 authFailed() 交给 runtime 翻成 proxy_auth_failed。

export type ProxySecretState = "unknown" | "saved" | "memory" | "mismatch" | "unreadable" | "none";
/** 结构类型：生产传 SecretFileStore，测试传桩。 */
export type ProxyAuthStore = Pick<SecretFileStore, "read" | "write" | "clear" | "securePersistence">;
export type ProxyLoginCallback = (username?: string, password?: string) => void;
export type ProxyLoginInfo = Pick<AuthInfo, "isProxy" | "host" | "port">;
export type ProxyPersistResult = SecretWriteResult | "cleared" | "failed";

export interface ProxyAuthBasis {
  readonly applied: ProxyPreference | null;
  readonly applying: ProxyPreference | null;
}

export const PROXY_SECRET_READ_TIMEOUT_MS = 5_000;
export const PROXY_AUTH_WINDOW_MS = 60_000;
export const PROXY_AUTH_FAILURE_LIMIT = 2;
/** unreadable 只代表那一次读取（钥匙串锁定/超时）；记录后至少隔这么久，下一次 407 或 refresh 才重读。 */
export const PROXY_SECRET_RETRY_MS = 30_000;

interface Route { readonly host: string; readonly port: number }
interface Waiter { readonly route: Route; readonly callback: ProxyLoginCallback }
interface Loading { readonly kind: "loading"; readonly waiters: Waiter[] }
/** null = 还没读过（惰性读盘）；unreadable 满 PROXY_SECRET_RETRY_MS 后同样可重读；tombstone 命中直接取消、不读盘。 */
type Entry =
  | { readonly kind: "secret"; readonly identity: ProxyIdentity; readonly password: string; readonly persisted: boolean }
  | { readonly kind: "tombstone" }
  | { readonly kind: "absent"; readonly reason: "none" | "unreadable"; readonly at: number }
  | Loading
  | { readonly kind: "wiping" };

export interface ProxyAuthSnapshot {
  readonly entry: Entry | null;
  readonly wipeEpoch: number;
}

const HOST_FORBIDDEN = /[\s/@?#\\]/;

/** host 规范化：小写、去方括号、IDN → punycode、IPv4/IPv6 规范形式；解析失败返回 null。 */
export function normalizeProxyHost(raw: string): string | null {
  const trimmed = String(raw ?? "").trim().toLowerCase();
  const inner = trimmed.startsWith("[") && trimmed.endsWith("]") ? trimmed.slice(1, -1) : trimmed;
  if (!inner || HOST_FORBIDDEN.test(inner)) return null;
  try {
    const parsed = new URL(`http://${inner.includes(":") ? `[${inner}]` : inner}/`).hostname;
    return parsed.startsWith("[") && parsed.endsWith("]") ? parsed.slice(1, -1) : parsed;
  } catch {
    return null;
  }
}

export function sameProxyIdentity(a: ProxyIdentity, b: ProxyIdentity): boolean {
  const host = normalizeProxyHost(a.host);
  return host !== null && a.scheme === b.scheme && Number(a.port) === Number(b.port) &&
    a.username === b.username && host === normalizeProxyHost(b.host);
}

function identityKey(identity: ProxyIdentity): string {
  return JSON.stringify([identity.scheme, normalizeProxyHost(identity.host), Number(identity.port), identity.username]);
}

/** proxy-secret.bin 的明文：身份与密码绑定在一起，换了身份就是 mismatch。 */
export function encodeProxySecret(identity: ProxyIdentity, password: string): string {
  return JSON.stringify({
    version: 1, scheme: identity.scheme, host: identity.host, port: identity.port, username: identity.username, password
  });
}

export function decodeProxySecret(raw: string): { identity: ProxyIdentity; password: string } | null {
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const { version, scheme, host, port, username, password } = value as Record<string, unknown>;
    if (version !== 1 || !PROXY_SCHEMES.includes(scheme as ProxyScheme)) return null;
    if (typeof host !== "string" || !host || typeof username !== "string") return null;
    if (typeof port !== "number" || !Number.isInteger(port) || port < 1 || port > 65535) return null;
    if (typeof password !== "string" || !password) return null;
    return { identity: { scheme: scheme as ProxyScheme, host, port, username }, password };
  } catch {
    return null;
  }
}

export class ProxyAuth {
  private basis: ProxyAuthBasis = { applied: null, applying: null };
  private entry: Entry | null = null;
  /** 代际号：只增不减，唯一作用是让进行中的磁盘读取作废。 */
  private gen = 0;
  /** 只在本机重置（beginWipe）时递增。 */
  private wipe = 0;
  private loadDone: Promise<void> = Promise.resolve();
  private readonly failures = new Map<string, { at: number[]; tripped: boolean }>();
  private readonly seen = new WeakSet<object>();
  private readonly listeners = new Set<() => void>();
  private readonly store: ProxyAuthStore;
  private readonly now: () => number;
  private readonly readTimeoutMs: number;

  constructor(opts: { store: ProxyAuthStore; now?: () => number; readTimeoutMs?: number }) {
    this.store = opts.store;
    this.now = opts.now ?? Date.now;
    this.readTimeoutMs = opts.readTimeoutMs ?? PROXY_SECRET_READ_TIMEOUT_MS;
  }

  wipeEpoch(): number { return this.wipe; }

  setBasis(basis: ProxyAuthBasis): void {
    this.basis = { applied: basis.applied, applying: basis.applying };
    this.emit();
  }

  /**
   * applyConfig 第 0 步 + 第 1 步的缓存部分（同步）：记快照、设 applying；身份变化或带了凭据时清零熔断、
   * 递增代际号并装入新凭据（string）或墓碑（null）；undefined 时只清掉与目标身份不一致的条目。
   * 调用方随后 await clearAuthCache()——先装入再清 Chromium 缓存，中间到达的 407 只会拿到新凭据。
   */
  beginApply(target: ProxyPreference, credential: string | null | undefined, identityChanged: boolean): ProxyAuthSnapshot {
    const snapshot: ProxyAuthSnapshot = { entry: this.entry, wipeEpoch: this.wipe };
    this.basis = { applied: this.basis.applied, applying: target };
    if ((identityChanged || credential !== undefined) && this.entry?.kind !== "wiping") {
      this.failures.clear();
      this.bumpGen();
      const identity = proxyIdentity(target);
      const current = this.entry;
      if (credential === null) this.entry = { kind: "tombstone" };
      // 非 custom 目标没有身份可绑定；proxy-ipc 已拒收这种 password，这里按「不改缓存」处理。
      else if (typeof credential === "string" && credential && identity) {
        this.entry = { kind: "secret", identity, password: credential, persisted: false };
      } else if (current?.kind === "secret" && !(identity && sameProxyIdentity(current.identity, identity))) {
        this.entry = null;
      }
    }
    this.emit();
    return snapshot;
  }

  /** applyConfig 第 5 步：期间没发生本机重置才恢复快照，并再递增一次代际号（永不回退）。 */
  restore(snapshot: ProxyAuthSnapshot): void {
    this.basis = { applied: this.basis.applied, applying: null };
    if (this.wipe === snapshot.wipeEpoch && this.entry?.kind !== "wiping") {
      this.bumpGen();
      const previous = snapshot.entry;
      this.entry = previous && (previous.kind === "loading" || previous.kind === "wiping") ? null : previous;
    }
    this.emit();
  }

  /** 站点视图与 Service Worker 的 app.on('login')：命中才同步 preventDefault，否则交给 Electron 默认取消。 */
  handleAppLogin(
    event: { preventDefault(): void },
    _webContents: unknown,
    details: Pick<AuthenticationResponseDetails, "firstAuthAttempt"> | null | undefined,
    authInfo: ProxyLoginInfo,
    callback: ProxyLoginCallback
  ): void {
    const route = this.routeOf(authInfo);
    if (!route) return;
    event.preventDefault();
    this.respond(route, details?.firstAuthAttempt === false, callback);
  }

  /** polyask-net 的请求级 login：不命中一律 callback() 取消；同一请求对象第二次进入记一次失败。 */
  handleRequestLogin(request: object, authInfo: ProxyLoginInfo, callback: ProxyLoginCallback): void {
    const route = this.routeOf(authInfo);
    if (!route) { callback(); return; }
    const retry = this.seen.has(request);
    this.seen.add(request);
    this.respond(route, retry, callback);
  }

  secretState(): ProxySecretState {
    const entry = this.entry;
    if (!entry || entry.kind === "loading" || entry.kind === "wiping") return "unknown";
    if (entry.kind === "tombstone") return "none";
    if (entry.kind === "absent") return entry.reason;
    const applied = proxyIdentity(this.basis.applied);
    if (!applied || !sameProxyIdentity(applied, entry.identity)) return "mismatch";
    return entry.persisted ? "saved" : "memory";
  }

  /** proxy-state 遇到 unknown 时调用：缓存为 null 或 unreadable 已满重试间隔才读盘（5s 超时），结束后经 onChange 推送。 */
  async refreshSecretState(): Promise<void> {
    if (this.readDue(this.entry)) this.startLoad();
    await this.loadDone;
  }

  /** 熔断只看已应用身份：设置卡据此提示「代理拒绝了当前凭据」。 */
  authFailed(): boolean {
    const identity = proxyIdentity(this.basis.applied);
    return identity !== null && this.isTripped(identity);
  }

  securePersistence(): Promise<boolean> { return this.store.securePersistence(); }

  /** proxy-set 落盘阶段：写入或清除 proxy-secret.bin；期间发生本机重置则 aborted，不改缓存。 */
  async persistCredential(target: ProxyPreference, credential: string | null, expectedWipeEpoch: number): Promise<ProxyPersistResult> {
    if (credential === null) {
      try { await this.store.clear(); } catch { return "failed"; }
      return this.wipe === expectedWipeEpoch ? "cleared" : "aborted";
    }
    const identity = proxyIdentity(target);
    if (!identity || !credential) return "failed";
    let result: SecretWriteResult;
    try {
      result = await this.store.write(encodeProxySecret(identity, credential), { epoch: () => this.wipe, expected: expectedWipeEpoch });
    } catch {
      return "failed";
    }
    if (this.wipe !== expectedWipeEpoch) return "aborted";
    const entry = this.entry;
    if (result === "saved" && entry?.kind === "secret" && entry.password === credential && sameProxyIdentity(entry.identity, identity)) {
      this.entry = { ...entry, persisted: true };
      this.emit();
    }
    return result;
  }

  /** 本机重置第 0、1、3 步：进入 wiping（命中的 login 一律取消且不读盘）、递增 wipeEpoch 与代际号、清零熔断。 */
  beginWipe(): void {
    this.wipe += 1;
    this.bumpGen();
    this.entry = { kind: "wiping" };
    this.failures.clear();
    this.emit();
  }

  /** 本机重置第 2 步；失败向调用方抛出，让整个重置失败。 */
  clearStored(): Promise<void> { return this.store.clear(); }

  /** 无论成功失败都要调用：缓存回到 null。 */
  endWipe(): void {
    if (this.entry?.kind === "wiping") this.entry = null;
    this.emit();
  }

  resetBreaker(): void {
    this.failures.clear();
    this.emit();
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  /** 监听方（如推送到已销毁的 webContents）抛错一律吞掉：不得跳过 407 回调，也不得把 wiping 卡死。 */
  private emit(): void {
    for (const listener of [...this.listeners]) {
      try { listener(); } catch { /* 隔离监听方故障 */ }
    }
  }

  private bumpGen(): void {
    this.gen += 1;
    const current = this.entry;
    if (current?.kind === "loading") {
      this.entry = null;
      this.flush(current, true);
    }
  }

  private routeOf(info: ProxyLoginInfo | null | undefined): Route | null {
    if (!info || info.isProxy !== true) return null;
    const host = normalizeProxyHost(info.host);
    const port = Number(info.port);
    if (!host || !Number.isInteger(port)) return null;
    const route = { host, port };
    return this.basesFor(route).length ? route : null;
  }

  /** 匹配基准：applying 与 applied 中 host/port 一致的 custom 身份。authInfo.scheme 是认证方案，不参与。 */
  private basesFor(route: Route): ProxyIdentity[] {
    const bases: ProxyIdentity[] = [];
    for (const value of [this.basis.applying, this.basis.applied]) {
      const identity = proxyIdentity(value);
      if (!identity || Number(identity.port) !== route.port || normalizeProxyHost(identity.host) !== route.host) continue;
      if (!bases.some(known => sameProxyIdentity(known, identity))) bases.push(identity);
    }
    return bases;
  }

  private respond(route: Route, failed: boolean, callback: ProxyLoginCallback): void {
    const bases = this.basesFor(route);
    const entry = this.entry;
    const identity = (entry?.kind === "secret" && bases.find(base => sameProxyIdentity(base, entry.identity))) || bases[0];
    if (!identity) { callback(); return; }
    if (failed) this.recordFailure(identity);
    if (this.isTripped(identity)) { callback(); return; }
    if (this.readDue(entry)) { this.startLoad().waiters.push({ route, callback }); return; }
    if (entry?.kind === "loading") { entry.waiters.push({ route, callback }); return; }
    this.settle(route, callback);
  }

  private settle(route: Route, callback: ProxyLoginCallback): void {
    const entry = this.entry;
    if (entry?.kind !== "secret") { callback(); return; }
    const match = this.basesFor(route).find(base => sameProxyIdentity(base, entry.identity));
    if (!match || this.isTripped(match)) { callback(); return; }
    callback(entry.identity.username, entry.password);
  }

  private readDue(entry: Entry | null): boolean {
    return entry === null ||
      (entry.kind === "absent" && entry.reason === "unreadable" && this.now() - entry.at >= PROXY_SECRET_RETRY_MS);
  }

  private startLoad(): Loading {
    const loading: Loading = { kind: "loading", waiters: [] };
    const startGen = this.gen;
    this.entry = loading;
    this.loadDone = new Promise<void>(resolve => {
      const timer = setTimeout(() => {
        if (this.entry === loading) {
          this.entry = null;
          this.flush(loading, true);
          this.emit();
        }
        resolve();
      }, this.readTimeoutMs);
      timer.unref?.();
      // 同步抛错也收进 Promise；fromRead 抛错同样按 unreadable，绝不逸出成未处理的 rejection。
      void new Promise<SecretReadResult>(done => done(this.store.read()))
        .then(result => this.fromRead(result))
        .catch((): Entry => ({ kind: "absent", reason: "unreadable", at: this.now() }))
        .then(next => {
          // 代际号变了（清除、换密码、重置、应用失败恢复）就丢弃结果；超时后晚到的结果在无变化时仍可采用。
          if (this.gen === startGen && (this.entry === loading || this.entry === null)) {
            this.entry = next;
            this.flush(loading, false);
            this.emit();
          }
        })
        .finally(() => { clearTimeout(timer); resolve(); });
    });
    return loading;
  }

  private fromRead(result: SecretReadResult): Entry {
    if (result.kind !== "ok") return { kind: "absent", reason: result.kind, at: this.now() };
    const decoded = decodeProxySecret(result.value);
    return decoded
      ? { kind: "secret", identity: decoded.identity, password: decoded.password, persisted: true }
      : { kind: "absent", reason: "unreadable", at: this.now() };
  }

  private flush(loading: Loading, cancel: boolean): void {
    for (const waiter of loading.waiters.splice(0)) {
      try {
        if (cancel) waiter.callback();
        else this.settle(waiter.route, waiter.callback);
      } catch { /* 单个回调故障不得拖住同批其它 407 */ }
    }
  }

  /** 同一身份 60s 窗口内累计 2 次失败即熔断；熔断一直保持到身份变化、换/清密码或本机重置。 */
  private recordFailure(identity: ProxyIdentity): void {
    const key = identityKey(identity);
    const now = this.now();
    const previous = this.failures.get(key);
    const at = (previous?.at ?? []).filter(time => now - time < PROXY_AUTH_WINDOW_MS);
    at.push(now);
    const tripped = previous?.tripped === true || at.length >= PROXY_AUTH_FAILURE_LIMIT;
    this.failures.set(key, { at, tripped });
    if (tripped && previous?.tripped !== true) this.emit();
  }

  private isTripped(identity: ProxyIdentity): boolean {
    return this.failures.get(identityKey(identity))?.tripped === true;
  }
}
