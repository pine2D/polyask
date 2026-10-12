import { DEFAULT_PROXY_PREFERENCE, sameRoute, type ProxyPreference, type ProxyScheme } from "../shared/proxy-preference";

/** 同步来的 S：与 state_items 里 preference:proxy 的形状一致（value/updatedAt/deviceId）。 */
export interface VersionedProxy {
  readonly value: ProxyPreference;
  readonly updatedAt: number;
  readonly deviceId: string;
}

/** 待本机确认的同步地址：只带线路三元组与 S 的版本，accept 时据此核对 store 里最新的 S。 */
export interface PendingConfirm {
  readonly scheme: ProxyScheme;
  readonly host: string;
  readonly port: number;
  readonly version: { readonly updatedAt: number; readonly deviceId: string };
}

export interface ProxyTargetInput {
  readonly following: boolean;
  readonly override: ProxyPreference | null;
  readonly shared: VersionedProxy | null;
  readonly accepted: ProxyPreference | null;
  /** 仅「打开跟随」那一次调用传入：比较基准固定为当时的已应用配置，忽略可能残留的 A。 */
  readonly appliedAtFollowOn?: ProxyPreference;
}

export interface ProxyTargetResult {
  readonly target: ProxyPreference;
  readonly pendingConfirm: PendingConfirm | null;
  /** applyConfig 校验通过后才写入 meta.proxyAccepted；null = 不写（不跟随时 A 保持不变）。 */
  readonly nextAccepted: ProxyPreference | null;
}

/**
 * §4.5 唯一纯函数。输入是 §3.3 带标签读取后的 ok 值，阻断情况已由 classifyProxyInputs 排除。
 * 同步带来的新地址（scheme/host/port 变化，或基准不是 custom 而 S 是 custom）一律先挂起确认，不改送流量。
 */
export function resolveProxyTarget(input: ProxyTargetInput): ProxyTargetResult {
  if (!input.following) return { target: input.override ?? DEFAULT_PROXY_PREFERENCE, pendingConfirm: null, nextAccepted: null };
  const base = input.appliedAtFollowOn ?? input.accepted ?? input.override;
  // 走到这里说明分类被绕过；抛错让调用方按阻断处理，绝不退回 system。
  if (!base) throw new Error("proxy_target_unresolved");
  const shared = input.shared;
  if (!shared) return { target: base, pendingConfirm: null, nextAccepted: base };
  const next = shared.value;
  if (next.mode !== "custom" || (base.mode === "custom" && sameRoute(next, base))) {
    return { target: next, pendingConfirm: null, nextAccepted: next };
  }
  return {
    target: base,
    nextAccepted: base,
    pendingConfirm: {
      scheme: next.scheme, host: next.host, port: next.port,
      version: { updatedAt: shared.updatedAt, deviceId: shared.deviceId }
    }
  };
}
