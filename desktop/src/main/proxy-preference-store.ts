import { isVersionedPreference, PREFERENCE_STATE_PREFIX } from "../shared/preferences";
import { isProxyPreference, type ProxyPreference } from "../shared/proxy-preference";
import { nextSyncTime } from "../shared/sync";
import type { MetaRepository } from "./meta-repository";
import type { ProxyTargetInput, VersionedProxy } from "./proxy-target";
import type { StateRepository } from "./state-repository";

/** S：同步投影按 preference: 前缀自动覆盖；本机重置随 state_items 清空。 */
export const PROXY_STATE_KEY = `${PREFERENCE_STATE_PREFIX}proxy`;
/** 本机 meta 键：不同步、不进备份，resetLocalData 只保留 deviceId 时一并清除。 */
export const PROXY_OVERRIDE_KEY = "proxyOverride";
export const PROXY_FOLLOWING_KEY = "proxyFollowing";
export const PROXY_ACCEPTED_KEY = "proxyAccepted";

export type Tagged<T> = { readonly kind: "absent" } | { readonly kind: "invalid" } | { readonly kind: "ok"; readonly value: T };

export interface ProxyInputs {
  readonly following: Tagged<boolean>;
  readonly override: Tagged<ProxyPreference>;
  readonly shared: Tagged<VersionedProxy>;
  readonly accepted: Tagged<ProxyPreference>;
}

export type ProxyClassification =
  | { readonly kind: "blocked"; readonly reason: "stored_invalid" }
  | { readonly kind: "resolve"; readonly input: ProxyTargetInput; readonly sharedInvalid: boolean };

export interface ProxyStoreDatabase {
  readonly state: StateRepository;
  readonly meta: MetaRepository;
  transaction<T>(action: () => T): T;
}

const ABSENT = { kind: "absent" } as const;
const INVALID = { kind: "invalid" } as const;
const BLOCKED = { kind: "blocked", reason: "stored_invalid" } as const;
const sameValue = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
const isBoolean = (value: unknown): value is boolean => typeof value === "boolean";
const okValue = <T>(tagged: Tagged<T>): T | null => tagged.kind === "ok" ? tagged.value : null;

export function isVersionedProxy(value: unknown): value is VersionedProxy {
  return isVersionedPreference("proxy", value) && isProxyPreference((value as { value?: unknown }).value);
}

/** 行不存在 = absent；存在但读不出、解析失败或不合规范 = invalid（绝不当 absent，否则损坏值会静默回落 system）。 */
function tagged<T>(present: () => boolean, read: () => unknown, valid: (value: unknown) => value is T): Tagged<T> {
  try {
    if (!present()) return ABSENT;
    const value = read();
    return valid(value) ? { kind: "ok", value } : INVALID;
  } catch { return INVALID; }
}

function requireProxy(value: unknown): asserts value is ProxyPreference {
  if (!isProxyPreference(value)) throw new Error("proxy_invalid");
}

/**
 * §3.3：损坏输入一律阻断；跟随时损坏的 S 视同 absent（只退回已确认的 A，不会 fail-open），并标 sharedInvalid（stored=invalid）。
 * 不跟随时 S 不参与解析，本机保存也修不了它，所以不标：否则设置卡一直报「已损坏」、同步设置行一直禁用，只能本机重置。
 */
export function classifyProxyInputs(inputs: ProxyInputs): ProxyClassification {
  if (inputs.following.kind === "invalid") return BLOCKED;
  const following = inputs.following.kind === "ok" && inputs.following.value;
  const sharedInvalid = following && inputs.shared.kind === "invalid";
  if (!following && inputs.override.kind === "invalid") return BLOCKED;
  if (following && inputs.accepted.kind === "invalid") return BLOCKED;
  if (following && inputs.accepted.kind === "absent" && inputs.override.kind !== "ok") return BLOCKED;
  return {
    kind: "resolve", sharedInvalid,
    input: { following, override: okValue(inputs.override), shared: okValue(inputs.shared), accepted: okValue(inputs.accepted) }
  };
}

/** proxy 四项原始值的唯一读写入口；不经过 PreferencesRepository 的 snapshot/readShared/readDevice。 */
export class ProxyPreferenceStore {
  private readonly now: () => number;
  private readonly deviceId: () => string;

  constructor(private readonly db: ProxyStoreDatabase,
    options: { readonly now?: () => number; readonly deviceId?: () => string } = {}) {
    this.now = options.now ?? Date.now;
    this.deviceId = options.deviceId ?? (() => {
      const id = this.db.meta.get<unknown>("deviceId");
      if (typeof id !== "string" || !id) throw new Error("device_id_missing");
      return id;
    });
  }

  /** 启动与运行时重算共用；从不调用 deviceId()，全新安装首启也不抛。 */
  read(): ProxyInputs {
    return {
      following: this.readFollowing(),
      override: this.readLocal(PROXY_OVERRIDE_KEY),
      shared: this.readShared(),
      accepted: this.readLocal(PROXY_ACCEPTED_KEY)
    };
  }

  /** proxy-set 第 5 步：跟随时写 S + A；否则写 override（following 损坏时顺带修复成 false 并删 A）。 */
  save(value: ProxyPreference): "local" | "following" {
    requireProxy(value);
    return this.db.transaction(() => {
      const following = this.readFollowing();
      if (following.kind === "ok" && following.value) {
        this.writeFollowingValue(value);
        return "following";
      }
      this.writeLocalValue(value, following.kind === "invalid");
      return "local";
    });
  }

  saveLocal(value: ProxyPreference): void {
    requireProxy(value);
    this.db.transaction(() => this.writeLocalValue(value, this.readFollowing().kind === "invalid"));
  }

  saveFollowing(value: ProxyPreference): void {
    requireProxy(value);
    this.db.transaction(() => this.writeFollowingValue(value));
  }

  /** 打开跟随成功后：following=true、A=实际应用值；事务内仍无合法 S 时才上传这份配置。 */
  enableFollowing(applied: ProxyPreference, uploadIfNoShared: boolean): void {
    requireProxy(applied);
    this.db.transaction(() => {
      this.db.meta.put(PROXY_FOLLOWING_KEY, true);
      this.db.meta.put(PROXY_ACCEPTED_KEY, applied);
      if (uploadIfNoShared && this.readShared().kind !== "ok") this.writeShared(applied);
    });
  }

  /** 关闭跟随：override=调用方给的 A（或已应用值），删 A；永不把未确认的 S 复制进本地。 */
  disableFollowing(override: ProxyPreference): void {
    requireProxy(override);
    this.db.transaction(() => {
      this.db.meta.put(PROXY_OVERRIDE_KEY, override);
      this.db.meta.put(PROXY_FOLLOWING_KEY, false);
      this.db.meta.delete(PROXY_ACCEPTED_KEY);
    });
  }

  /** applyConfig 校验通过后写 nextAccepted；不在跟随状态时不写（防止关闭跟随后复活 A），返回是否写入。 */
  setAccepted(value: ProxyPreference): boolean {
    requireProxy(value);
    return this.db.transaction(() => {
      const following = this.readFollowing();
      if (following.kind !== "ok" || !following.value) return false;
      this.db.meta.put(PROXY_ACCEPTED_KEY, value);
      return true;
    });
  }

  private readFollowing(): Tagged<boolean> {
    return tagged(() => this.db.meta.has(PROXY_FOLLOWING_KEY), () => this.db.meta.get<unknown>(PROXY_FOLLOWING_KEY), isBoolean);
  }

  private readLocal(key: string): Tagged<ProxyPreference> {
    return tagged(() => this.db.meta.has(key), () => this.db.meta.get<unknown>(key), isProxyPreference);
  }

  private readShared(): Tagged<VersionedProxy> {
    return tagged(() => this.db.state.has(PROXY_STATE_KEY), () => this.db.state.get<unknown>(PROXY_STATE_KEY), isVersionedProxy);
  }

  private writeLocalValue(value: ProxyPreference, repairFollowing: boolean): void {
    this.db.meta.put(PROXY_OVERRIDE_KEY, value);
    if (!repairFollowing) return;
    this.db.meta.put(PROXY_FOLLOWING_KEY, false);
    this.db.meta.delete(PROXY_ACCEPTED_KEY);
  }

  private writeFollowingValue(value: ProxyPreference): void {
    this.db.meta.put(PROXY_ACCEPTED_KEY, value);
    this.writeShared(value);
  }

  private writeShared(value: ProxyPreference): void {
    const current = this.readShared();
    const previous = current.kind === "ok" ? current.value : null;
    if (previous && previous.updatedAt > 0 && sameValue(previous.value, value)) return;
    const updatedAt = nextSyncTime(this.now(), ...(previous ? [previous.updatedAt] : []));
    const candidate: VersionedProxy = { value, updatedAt, deviceId: this.deviceId() };
    if (!isVersionedProxy(candidate)) throw new Error("proxy_invalid");
    // enqueue=true：写 state_items 并入 outbox（state:preference:proxy），与上面的 meta 写入同一事务。
    this.db.state.put(PROXY_STATE_KEY, candidate, updatedAt);
  }
}
