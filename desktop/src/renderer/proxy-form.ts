// desktop/src/renderer/proxy-form.ts
// 代理设置卡的纯逻辑：表单 ↔ 偏好值、密码取值约定（undefined 不改 / null 清除）、提示条件、
// 以及把 IPC 回包与抛错规整成「成功 / 码」。不产文案，文案由 shared/proxy-copy.ts 翻译。
import {
  checkProxyInput, isProxyPreference, PROXY_SCHEMES, proxyPasswordProblem,
  type ProxyInputCheck, type ProxyMode, type ProxyPreference, type ProxyRoute, type ProxyScheme
} from "../shared/proxy-preference";
import type { ProxyStateView } from "../shared/proxy-state";

/** 设置卡与同步行只认 proxy-state 通道的回包形状（spec §6.1，线格式由 T14 的 shared/proxy-state.ts 定义），不读偏好快照。 */
export type { ProxyStateView };

export interface ProxyForm {
  readonly mode: ProxyMode;
  readonly scheme: ProxyScheme;
  readonly host: string;
  readonly port: string;
  readonly bypass: string;
  readonly username: string;
}

export interface ProxyRequest {
  readonly value: ProxyPreference;
  readonly password?: string;
}

export type ProxyOutcome = { readonly ok: true; readonly secretFailed: boolean } | { readonly ok: false; readonly code: string | null };
export type ProxyTestOutcome =
  | { readonly ok: true; readonly ms: number; readonly route: "proxy" | "direct" }
  | { readonly ok: false; readonly code: string | null };
export type ProxyReloadOutcome = { readonly ok: true; readonly skipped: readonly string[] } | { readonly ok: false; readonly code: string | null };

const SECRETS = ["unknown", "saved", "memory", "mismatch", "unreadable", "none"];

export function isSocks(scheme: ProxyScheme): boolean {
  return scheme === "socks4" || scheme === "socks5";
}

export function formFromPreference(value: ProxyPreference): ProxyForm {
  return { mode: value.mode, scheme: value.scheme, host: value.host, port: value.port ? String(value.port) : "",
    bypass: value.bypass.join("\n"), username: value.username };
}

/** 原始输入：恰好 7 个字段；SOCKS 时用户名置空；端口只认纯数字，其余交给 checkProxyInput 判错。 */
export function rawFromForm(form: ProxyForm): unknown {
  const port = form.port.trim();
  return {
    version: 1, mode: form.mode, scheme: form.scheme, host: form.host.trim(),
    port: port === "" ? 0 : /^\d{1,5}$/.test(port) ? Number(port) : Number.NaN,
    bypass: form.bypass.split(/\r?\n/).map(rule => rule.trim()).filter(Boolean),
    username: isSocks(form.scheme) ? "" : form.username
  };
}

/**
 * 字符级校验 → 规范化 → 校验（与 IPC 入口同一个函数）。非自定义模式下隐藏的自定义字段若不合法，
 * 改用上一份已接受值的自定义字段：用户看不见、也改不了的字段不能挡住「切到跟随系统」。
 */
export function checkProxyForm(form: ProxyForm, fallback: ProxyPreference): ProxyInputCheck {
  const first = checkProxyInput(rawFromForm(form));
  if (first.ok || form.mode === "custom") return first;
  return checkProxyInput(rawFromForm({ ...formFromPreference(fallback), mode: form.mode }));
}

/** 与 IPC 入口同一个判定（T3 proxyPasswordProblem）；null = 密码框未编辑，空串在 proxyRequest 里按「不改动」处理。 */
export function passwordProblem(password: string | null): boolean {
  return password !== null && proxyPasswordProblem(password);
}

/**
 * 密码取值约定（spec §3.4）：只有密码框被编辑过且非空时才带 password；未编辑或清空 = 不改动（不发送字段）；
 * 清除已存密码走单独的按钮（发送 null），不经过这里。SOCKS 与非自定义模式一律不带密码。
 */
export function proxyRequest(value: ProxyPreference, password: string | null): ProxyRequest {
  if (value.mode !== "custom" || isSocks(value.scheme) || password === null || password === "") return { value };
  return { value, password };
}

export function isLoopbackHost(host: string): boolean {
  const value = host.trim().toLowerCase().replace(/^\[(.*)\]$/, "$1");
  return value === "localhost" || value.endsWith(".localhost") || value === "::1" || /^127(\.\d{1,3}){3}$/.test(value);
}

/**
 * 主机栏是否粘贴了 URL、`host:port` 或 `user@host`（Review Focus 3）。只用来挑更具体的提示文案；
 * 拒收与否仍由 checkProxyInput 决定，输入原样保留、绝不截断。不带方括号的 IPv6（多个冒号）不算。
 */
export function hostLooksCombined(host: string): boolean {
  const value = host.trim();
  return /[@/]/.test(value) || /^[^:[\]]+:\d*$/.test(value) || /^\[[^\]]*\]:\d*$/.test(value);
}

/** 两份表单逐字段相同：判断草稿是否仍等于编辑起点（改了又改回不算未保存修改）。 */
export function sameProxyForm(a: ProxyForm, b: ProxyForm): boolean {
  return a.mode === b.mode && a.scheme === b.scheme && a.host === b.host && a.port === b.port && a.bypass === b.bypass && a.username === b.username;
}

/** 展示用 `host:port`；IPv6 加方括号。 */
export function proxyEndpoint(route: Pick<ProxyRoute, "host" | "port">): string {
  return `${route.host.includes(":") ? `[${route.host}]` : route.host}:${route.port}`;
}

/** 「需要为当前代理输入密码」类提示里的 host:port（spec §4.5）：优先已生效的自定义代理，否则取表单预填值。 */
export function proxyStateEndpoint(state: ProxyStateView): string {
  return proxyEndpoint(state.applied?.mode === "custom" ? state.applied : state.formValue);
}

export interface ProxyFormHints {
  readonly socks: boolean;
  readonly socks4Dns: boolean;
  readonly plaintext: boolean;
  readonly linuxEnv: boolean;
}

export function proxyFormHints(form: ProxyForm, linuxDesktopProxy: ProxyStateView["linuxDesktopProxy"]): ProxyFormHints {
  const custom = form.mode === "custom";
  return {
    socks: custom && isSocks(form.scheme),
    socks4Dns: custom && form.scheme === "socks4",
    plaintext: custom && form.scheme === "http" && form.username.trim() !== "" && form.host.trim() !== "" && !isLoopbackHost(form.host),
    linuxEnv: form.mode === "system" && linuxDesktopProxy === "env"
  };
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

/** proxy-set / follow / accept 的回包：`{ok:true, secret?:"failed"}` 或 `{ok:false, result}`；形状不对按未知失败处理。 */
export function proxyOutcome(value: unknown): ProxyOutcome {
  const body = record(value);
  if (body?.ok === true) return { ok: true, secretFailed: body.secret === "failed" };
  if (body?.ok === false && typeof body.result === "string") return { ok: false, code: body.result };
  return { ok: false, code: null };
}

export function proxyTestOutcome(value: unknown): ProxyTestOutcome {
  const body = record(value);
  if (body?.ok === true && typeof body.ms === "number" && Number.isFinite(body.ms) && (body.route === "proxy" || body.route === "direct")) {
    return { ok: true, ms: Math.max(0, Math.round(body.ms)), route: body.route };
  }
  if (body?.ok === false && typeof body.result === "string") return { ok: false, code: body.result };
  return { ok: false, code: null };
}

/** IPC 抛错时 preload 已剥成裸码（shared/ipc-error.ts）；不是裸码形状的一律视为未知。 */
export function proxyErrorCode(error: unknown): string | null {
  return error instanceof Error && /^[a-z][a-z0-9_]*$/.test(error.message) ? error.message : null;
}

function pendingOk(value: unknown): boolean {
  if (value === null) return true;
  const body = record(value), version = record(body?.version);
  return !!body && !!version && PROXY_SCHEMES.includes(body.scheme as ProxyScheme) && typeof body.host === "string"
    && typeof body.port === "number" && typeof version.updatedAt === "number" && typeof version.deviceId === "string";
}

/** 推送与读取的回包都先过这一道：旧夹具或桥异常时返回的形状不对，设置卡显示「无法读取」而不是崩溃。 */
export function isProxyStateView(value: unknown): value is ProxyStateView {
  const body = record(value);
  return !!body && isProxyPreference(body.formValue) && (body.applied === null || isProxyPreference(body.applied))
    && typeof body.blocked === "boolean" && typeof body.pending === "boolean" && typeof body.following === "boolean"
    && typeof body.encryption === "boolean" && typeof body.authFailed === "boolean" && (body.stored === "ok" || body.stored === "invalid")
    && (body.appliedResult === "ok" || body.appliedResult === "proxy_apply_failed")
    && SECRETS.includes(body.secret as string) && [null, "desktop", "env"].includes(body.linuxDesktopProxy as string | null)
    && pendingOk(body.pendingConfirm);
}

/** 待确认项的身份键：同一版本只提示一次。 */
export function pendingKey(state: ProxyStateView | null): string | null {
  const pending = state?.pendingConfirm;
  return pending ? `${pending.version.deviceId}\u0000${pending.version.updatedAt}` : null;
}

/** reload-sites 回包（T14 `ProxyReloadResult`）：`{ok:true, skipped}` 或 `{ok:false, result:"proxy_busy"}`；形状不对按未知失败处理。 */
export function proxyReloadOutcome(value: unknown): ProxyReloadOutcome {
  const body = record(value);
  const skipped = body?.skipped;
  if (body?.ok === true && Array.isArray(skipped) && skipped.every(site => typeof site === "string")) return { ok: true, skipped: [...skipped] as string[] };
  if (body?.ok === false && typeof body.result === "string") return { ok: false, code: body.result };
  return { ok: false, code: null };
}
