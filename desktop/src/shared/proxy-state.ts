// desktop/src/shared/proxy-state.ts
// 代理 IPC 的线格式：主进程、preload、渲染层共用，只有类型，打进渲染层不带任何运行时代码。
// 失败码放在 result 字段（不叫 code）：代理 IPC 码由 shared/proxy-copy.ts 翻译，不进 SITE_CODES（spec §5.3）。
import type { SiteKey } from "./contracts";
import type { ProxyField, ProxyPreference, ProxyScheme } from "./proxy-preference";

/**
 * proxy-state 的可选入参。secret: true 只由设置卡发出：密码状态为 unknown 或 unreadable 时交给 auth 后台读一次
 * 密码文件（unreadable 是否已满重试间隔由 proxy-auth 判断）。
 * 其余调用方（外壳顶层提示、诊断报告）不带它，只读状态，不触发解密——spec §3.3 启动时不读密码。
 */
export interface ProxyStateRequest {
  readonly secret?: boolean;
}

/** 与 main/proxy-auth.ts 的 ProxySecretState 同值；main/proxy-ipc.ts 逐字段拷贝时由 tsc 对账。 */
export type ProxySecretStateView = "unknown" | "saved" | "memory" | "mismatch" | "unreadable" | "none";

/** 同步带来、尚待本机确认的新代理地址；version 是 S 的 {updatedAt, deviceId}，accept 时原样带回。 */
export interface ProxyPendingConfirmView {
  readonly scheme: ProxyScheme;
  readonly host: string;
  readonly port: number;
  readonly version: { readonly updatedAt: number; readonly deviceId: string };
}

export interface ProxyStateView {
  /** 最近一次校验通过的配置；阻断配置不算。 */
  readonly applied: ProxyPreference | null;
  readonly blocked: boolean;
  readonly stored: "ok" | "invalid";
  readonly appliedResult: "ok" | "proxy_apply_failed";
  /** 有后台重算在等空闲或重置结束。 */
  readonly pending: boolean;
  readonly pendingConfirm: ProxyPendingConfirmView | null;
  readonly following: boolean;
  /** 设置卡预填值：不跟随为本机 override，跟随为当前 target（不含待确认的 S）。 */
  readonly formValue: ProxyPreference;
  readonly secret: ProxySecretStateView;
  /** 密码能否加密落盘；false 时只存在本次运行的内存里。 */
  readonly encryption: boolean;
  readonly linuxDesktopProxy: "desktop" | "env" | null;
  /** 代理在 60s 内两次拒绝当前凭据（407 熔断），设置卡提示重新输入密码。 */
  readonly authFailed: boolean;
}

/** 校验失败的字段，供设置卡用 aria-describedby 关联错误信息。 */
export type ProxyInvalidField = ProxyField | "password";
export type ProxyWriteFailure = "proxy_invalid" | "proxy_busy" | "proxy_apply_failed" | "proxy_not_pending" | "proxy_pending_confirm";
/** secret: "failed" = 配置已生效、密码写盘失败（只在本次运行有效），渲染层译为 proxy_secret_failed。 */
export type ProxyWriteResult =
  | { readonly ok: true; readonly secret?: "failed" }
  | { readonly ok: false; readonly result: ProxyWriteFailure; readonly field?: ProxyInvalidField };

export interface ProxySetRequest {
  readonly value: ProxyPreference;
  /** undefined = 不改动；null = 清除已存密码；"" 拒收。渲染层只在密码框被编辑过时才发送字符串。 */
  readonly password?: string | null;
}

export type ProxyAcceptRequest = ProxyPendingConfirmView;

export interface ProxyTestRequest {
  readonly value: ProxyPreference;
  readonly password?: string;
}

export type ProxyTestFailure =
  | "proxy_invalid" | "proxy_failed" | "proxy_auth_failed" | "network_error" | "network_timeout" | "proxy_apply_failed" | "proxy_test_busy";
export type ProxyTestResult =
  | { readonly ok: true; readonly ms: number; readonly route: "proxy" | "direct" }
  | { readonly ok: false; readonly result: ProxyTestFailure };

export type ProxyReloadResult =
  | { readonly ok: true; readonly skipped: readonly SiteKey[] }
  | { readonly ok: false; readonly result: "proxy_busy" };
