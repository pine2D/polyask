// desktop/src/main/proxy-runtime.ts
// 全局代理的应用核心（spec §3.2–§3.4、§4.6）：把目标配置应用到受管出口并用 resolveProxy 校验（fail-closed），
// 持有「已应用配置」作为认证匹配与密码状态的基准；负责后台重算的脏标记与 gate、写锁、本机重置互斥和 WebRTC 策略。
// 只产出结果码与状态枚举，不产出任何用户可见文案。

import {
  BLOCKING_PROXY_CONFIG, DEFAULT_PROXY_PREFERENCE, PROXY_CHECK_URL, expectedResolve, sameIdentity, toProxyConfig,
  type ProxyPreference
} from "../shared/proxy-preference";
import type { ProxySecretState } from "./proxy-auth";
import { classifyProxyInputs, type ProxyInputs } from "./proxy-preference-store";
import { resolveProxyTarget, type PendingConfirm, type ProxyTargetResult } from "./proxy-target";

export type ApplyResult = { readonly ok: true } | { readonly ok: false; readonly result: "proxy_apply_failed" | "proxy_busy" };
export type WebRtcPolicy = "default" | "disable_non_proxied_udp";
export type LinuxDesktopProxy = "desktop" | "env" | null;

export interface ProxyRuntimeState {
  /** 最近一次校验通过的配置；阻断配置永远不记在这里。 */
  readonly applied: ProxyPreference | null;
  readonly blocked: boolean;
  readonly stored: "ok" | "invalid";
  readonly appliedResult: "ok" | "proxy_apply_failed";
  /** 有后台重算在等 gate 空闲或重置结束。 */
  readonly pending: boolean;
  readonly pendingConfirm: PendingConfirm | null;
  readonly following: boolean;
  /** 设置卡预填值：不跟随时为本机 override，跟随时为当前 target（不含待确认的 S）。 */
  readonly formValue: ProxyPreference;
  readonly secret: ProxySecretState;
  readonly linuxDesktopProxy: LinuxDesktopProxy;
}

export type ProxySession = Pick<Electron.Session, "setProxy" | "resolveProxy" | "clearAuthCache">;
export type ProxyWebContents = Pick<Electron.WebContents, "isDestroyed" | "setWebRTCIPHandlingPolicy">;

/** proxy-auth（T8）里 runtime 用到的部分；snapshot 对 runtime 不透明，只原样交回 restore。 */
export interface ProxyAuthPort {
  setBasis(basis: { applied: ProxyPreference | null; applying: ProxyPreference | null }): void;
  /** 同步：设 applying；身份变化或带 credential 时清零熔断、递增 gen、装入凭据或墓碑。须在 clearAuthCache 之前调用。 */
  beginApply(target: ProxyPreference, credential: string | null | undefined, identityChanged: boolean): unknown;
  restore(snapshot: unknown): void;
  resetBreaker(): void;
  /** 本机重置代数，只在 beginWipe 时递增；runtime 不另外计数。 */
  wipeEpoch(): number;
  beginWipe(): void;
  endWipe(): void;
  secretState(): ProxySecretState;
  onChange(listener: () => void): () => void;
}

/** OperationGate 满足此接口。 */
export interface ProxyBusyGate {
  readonly busy: boolean;
  onIdle(listener: () => void): () => void;
  run<T>(action: () => Promise<T>): Promise<T>;
}

export interface ProxyRuntimeOptions {
  /** setProxy / clearAuthCache 的受管出口（proxy-sessions.managedSessions）。 */
  readonly sessions: () => readonly ProxySession[];
  /** resolveProxy 校验的出口（proxy-sessions.verifySessions）。 */
  readonly verifySessions: () => readonly ProxySession[];
  readonly app: { setProxy(config: Electron.ProxyConfig): Promise<void> };
  readonly auth: ProxyAuthPort;
  readonly store: { read(): ProxyInputs; setAccepted(value: ProxyPreference): unknown };
  /** 与 proxy-auth 共用的 proxy-secret.bin；只在 wipeSecrets 里清除。 */
  readonly secrets: { clear(): Promise<void> };
  /** 现存站点视图的 webContents，用于更新 WebRTC 策略。 */
  readonly webContents: () => readonly ProxyWebContents[];
  /** 加密可用性不在这里：只经 auth.securePersistence()（T8）读取。 */
  readonly environment?: { readonly linuxDesktopProxy?: LinuxDesktopProxy };
  readonly sleep?: (ms: number) => Promise<void>;
  readonly now?: () => number;
}

const VERIFY_WINDOW_MS = 2_000;
const VERIFY_INTERVAL_MS = 100;
const OK: ApplyResult = Object.freeze({ ok: true });
const APPLY_FAILED: ApplyResult = Object.freeze({ ok: false, result: "proxy_apply_failed" });
const BUSY: ApplyResult = Object.freeze({ ok: false, result: "proxy_busy" });
const sameJson = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
const GSETTINGS_OR_KDE = new Set(["gnome", "unity", "x-cinnamon", "cinnamon", "pantheon", "deepin", "ukui", "kde"]);

/** Chromium 在 Linux 上只对这些桌面读 gsettings/kioslaverc；其余（含无桌面、WSL、裸 X）读 *_proxy 环境变量。 */
export function linuxDesktopProxySource(platform: string, env: Readonly<Record<string, string | undefined>>): LinuxDesktopProxy {
  if (platform !== "linux") return null;
  const desktops = (env.XDG_CURRENT_DESKTOP ?? "").split(":").map(entry => entry.trim().toLowerCase());
  return desktops.some(entry => GSETTINGS_OR_KDE.has(entry)) ? "desktop" : "env";
}

export class ProxyRuntime {
  private applied: ProxyPreference | null = null;
  private blocked = false;
  private appliedResult: "ok" | "proxy_apply_failed" = "ok";
  private stored: "ok" | "invalid" = "ok";
  private pendingConfirm: PendingConfirm | null = null;
  private following = false;
  private formValue: ProxyPreference = DEFAULT_PROXY_PREFERENCE;
  private dirty = false;
  private recomputing = false;
  private applyTail: Promise<unknown> = Promise.resolve();
  private writeTail: Promise<unknown> = Promise.resolve();
  private gate: ProxyBusyGate | null = null;
  private resetting: () => boolean = () => false;
  private unbindGate: (() => void) | null = null;
  private readonly listeners = new Set<() => void>();
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;

  constructor(private readonly options: ProxyRuntimeOptions) {
    this.sleep = options.sleep ?? (ms => new Promise<void>(resolve => setTimeout(resolve, ms)));
    this.now = options.now ?? Date.now;
    options.auth.onChange(() => this.emit());
  }

  /** 供已持有 OperationGate 与写锁的 IPC、以及启动使用：不检查忙碌；多次调用按到达顺序串行。 */
  applyNow(target: ProxyPreference, credential?: string | null): Promise<ApplyResult> {
    return this.serial(() => this.applyConfig(target, credential));
  }

  /** 偏好 refresh 回调：只设脏标记、不带值；空闲时经 gate + 写锁从 store 读最新输入重算。 */
  request(): void {
    const changed = !this.dirty;
    this.dirty = true;
    if (changed) this.emit();
    this.kick();
  }

  /** 在 shell-ipc 创建 OperationGate 之后注入；注入前视为不忙。isResetting 来自 DataAdminService。 */
  bindBusySource(gate: ProxyBusyGate, isResetting: () => boolean = () => false): void {
    this.unbindGate?.();
    this.gate = gate;
    this.resetting = isResetting;
    this.unbindGate = gate.onIdle(() => this.kick());
    this.kick();
  }

  /** 代理写锁：先取 gate 再取锁；重置一侧只取锁。不可重入。 */
  withWriteLock<T>(action: () => Promise<T>): Promise<T> {
    const run = this.writeTail.then(action);
    this.writeTail = run.catch(() => undefined);
    return run;
  }

  /** 委托给 auth（spec §3.6：wipeEpoch 属于认证缓存），runtime 与 proxy-ipc 读到的是同一个值。 */
  wipeEpoch(): number {
    return this.options.auth.wipeEpoch();
  }

  /** 本机重置（§4.6）：等整条写管线结束；任何一步失败都向上抛，调用方让重置整体失败。 */
  wipeSecrets(): Promise<void> {
    return this.withWriteLock(async () => {
      const { auth, secrets } = this.options;
      auth.beginWipe(); // 递增 wipeEpoch 与 gen，缓存置 "wiping"
      try {
        await secrets.clear();
        auth.resetBreaker();
        await this.clearAuthCaches();
      } finally {
        auth.endWipe();
        this.emit();
      }
    });
  }

  /** 读 store 最新输入 → 分类 → 解析 → 应用。调用方须已持有写锁（启动阶段除外）；后台路径请用 request()。 */
  async recomputeFromStore(): Promise<void> {
    const epoch = this.wipeEpoch();
    this.dirty = false;
    const inputs = this.options.store.read();
    const classified = classifyProxyInputs(inputs);
    let resolved: ProxyTargetResult | null = null;
    if (classified.kind === "resolve") {
      try { resolved = resolveProxyTarget(classified.input); } catch { resolved = null; }
    }
    this.following = inputs.following.kind === "ok" && inputs.following.value;
    if (classified.kind !== "resolve" || !resolved) {
      this.stored = "invalid";
      this.pendingConfirm = null;
      this.formValue = this.applied ?? DEFAULT_PROXY_PREFERENCE;
      await this.serial(() => this.enterBlocked());
      return;
    }
    this.stored = classified.sharedInvalid ? "invalid" : "ok";
    this.pendingConfirm = resolved.pendingConfirm;
    this.formValue = resolved.target;
    const result = await this.applyNow(resolved.target);
    const next = resolved.nextAccepted;
    if (result.ok && next && this.wipeEpoch() === epoch && !sameJson(next, classified.input.accepted)) this.options.store.setAccepted(next);
    this.emit();
  }

  state(): ProxyRuntimeState {
    return {
      applied: this.applied, blocked: this.blocked, stored: this.stored, appliedResult: this.appliedResult,
      pending: this.dirty, pendingConfirm: this.pendingConfirm, following: this.following, formValue: this.formValue,
      secret: this.options.auth.secretState(),
      linuxDesktopProxy: this.options.environment?.linuxDesktopProxy ?? null
    };
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  /** 已应用 custom 或处于阻断时禁止非代理 UDP；新视图在 site-view 创建点读取，现存视图由 applyWebRtc 遍历。 */
  webrtcPolicy(): WebRtcPolicy {
    return this.blocked || this.applied?.mode === "custom" ? "disable_non_proxied_udp" : "default";
  }

  private serial<T>(action: () => Promise<T>): Promise<T> {
    const run = this.applyTail.then(action);
    this.applyTail = run.catch(() => undefined);
    return run;
  }

  private kick(): void {
    if (!this.dirty || this.recomputing || this.resetting()) return;
    const gate = this.gate;
    if (gate?.busy) return;
    this.recomputing = true;
    const job = () => this.withWriteLock(() => this.recomputeFromStore());
    void (gate ? gate.run(job) : job()).catch(() => undefined).finally(() => {
      this.recomputing = false;
      this.emit();
      this.kick();
    });
  }

  /** §3.2 第 0–5 步。 */
  private async applyConfig(target: ProxyPreference, credential: string | null | undefined): Promise<ApplyResult> {
    const { auth } = this.options;
    const epoch = this.wipeEpoch();
    const previous = this.applied;
    const identityChanged = !sameIdentity(target, previous);
    auth.setBasis({ applied: previous, applying: target });
    let snapshot: { readonly value: unknown } | null = null;
    let verified = false;
    try {
      // 第 1 步：先同步装入新凭据或墓碑（T8 约定），再清 Chromium 认证缓存；
      // 反过来的话，两步之间到达的 407 会拿到旧密码并被重新缓存。
      snapshot = { value: auth.beginApply(target, credential, identityChanged) };
      if (identityChanged || credential !== undefined) {
        await this.clearAuthCaches();
        this.assertEpoch(epoch);
        auth.resetBreaker();
      }
      verified = await this.route(target, previous, epoch);
    } catch {
      verified = false;
    }
    if (verified && this.wipeEpoch() === epoch) {
      this.applied = target;
      this.blocked = false;
      this.appliedResult = "ok";
      auth.setBasis({ applied: target, applying: null });
      this.afterApply();
      return OK;
    }
    const wiped = this.wipeEpoch() !== epoch;
    if (snapshot && !wiped) auth.restore(snapshot.value);
    auth.setBasis({ applied: previous, applying: null });
    await this.fallback(previous);
    this.appliedResult = "proxy_apply_failed";
    this.afterApply();
    return wiped ? BUSY : APPLY_FAILED;
  }

  /** 第 2、3 步；线路配置与已应用配置相同且未阻断时跳过（幂等）。 */
  private async route(target: ProxyPreference, previous: ProxyPreference | null, epoch: number): Promise<boolean> {
    const config = toProxyConfig(target);
    if (previous && !this.blocked && sameJson(toProxyConfig(previous), config)) return true;
    await this.setAll(config, false);
    this.assertEpoch(epoch);
    return this.verify(target, epoch);
  }

  /** 第 5 步：绝不回退 system。有上一份已应用配置就恢复并重新校验；没有或仍失败就阻断。 */
  private async fallback(previous: ProxyPreference | null): Promise<void> {
    if (previous) {
      try {
        await this.setAll(toProxyConfig(previous), false);
        if (await this.verify(previous, this.wipeEpoch())) { this.blocked = false; return; }
      } catch { /* 恢复失败按阻断处理 */ }
    }
    await this.block();
  }

  private async enterBlocked(): Promise<void> {
    await this.block();
    this.appliedResult = "proxy_apply_failed";
    this.options.auth.setBasis({ applied: this.applied, applying: null });
    this.afterApply();
  }

  /** 阻断配置只标 blocked，不改 applied。逐个出口尽力写入，单个失败不影响其它出口。 */
  private async block(): Promise<void> {
    this.blocked = true;
    await this.setAll(BLOCKING_PROXY_CONFIG, true);
  }

  private async setAll(config: Electron.ProxyConfig, tolerant: boolean): Promise<void> {
    const targets: { setProxy(config: Electron.ProxyConfig): Promise<void> }[] = [...this.options.sessions(), this.options.app];
    for (const target of targets) {
      try { await target.setProxy(config); } catch (error) { if (!tolerant) throw error; }
    }
  }

  /** 第 3 步：system 不比较；其余在 2s 窗口内有界重试，站点与 net 两个出口都要命中期望值。 */
  private async verify(target: ProxyPreference, epoch: number): Promise<boolean> {
    const expected = expectedResolve(target);
    if (expected === null) return true;
    const deadline = this.now() + VERIFY_WINDOW_MS;
    for (;;) {
      if (await this.resolvesTo(expected)) return true;
      this.assertEpoch(epoch);
      const left = deadline - this.now();
      if (left <= 0) return false;
      await this.sleep(Math.min(VERIFY_INTERVAL_MS, left));
      this.assertEpoch(epoch);
    }
  }

  private async resolvesTo(expected: string): Promise<boolean> {
    for (const session of this.options.verifySessions()) {
      const actual = await session.resolveProxy(PROXY_CHECK_URL).catch(() => null);
      if (actual === null || actual.trim() !== expected) return false;
    }
    return true;
  }

  private async clearAuthCaches(): Promise<void> {
    for (const session of this.options.sessions()) await session.clearAuthCache();
  }

  private assertEpoch(epoch: number): void {
    if (this.wipeEpoch() !== epoch) throw new Error("proxy_busy");
  }

  private afterApply(): void {
    const policy = this.webrtcPolicy();
    for (const contents of this.options.webContents()) {
      try { if (!contents.isDestroyed()) contents.setWebRTCIPHandlingPolicy(policy); } catch { /* 视图正在销毁 */ }
    }
    this.emit();
  }

  private emit(): void {
    for (const listener of [...this.listeners]) {
      try { listener(); } catch { /* 订阅方故障不影响代理状态 */ }
    }
  }
}
