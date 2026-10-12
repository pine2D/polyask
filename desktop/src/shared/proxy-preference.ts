// desktop/src/shared/proxy-preference.ts
// 全局代理偏好的纯函数：类型、默认值、字符级校验、规范化、校验，以及翻译成 Chromium 代理配置。
// IPC 入口走 checkProxyInput（字符级 → 规范化 → 校验）；同步、备份、本地读取进来的值只走
// isProxyPreference，不是规范形式一律拒收。本文件只产出字段名与配置，不产出任何用户可见文案。

export type ProxyMode = "system" | "direct" | "custom";
export type ProxyScheme = "http" | "https" | "socks4" | "socks5";
export type ProxyField = "host" | "port" | "bypass" | "username" | "shape";

export interface ProxyPreference {
  readonly version: 1;
  readonly mode: ProxyMode;
  readonly scheme: ProxyScheme;
  /** 规范形式：小写、punycode、规范 IPv4、IPv6 不带方括号；mode≠custom 时可为 ""。 */
  readonly host: string;
  /** custom 时 1–65535；否则 0 或 1–65535。 */
  readonly port: number;
  /** 规范形式：去首尾空白、无空项、去重；≤ 64 条，每条 ≤ 253 字符。 */
  readonly bypass: string[];
  /** ≤ 255；socks4/socks5 时必为 ""。 */
  readonly username: string;
}

export interface ProxyRoute {
  readonly scheme: ProxyScheme;
  readonly host: string;
  readonly port: number;
}

export interface ProxyIdentity extends ProxyRoute {
  readonly username: string;
}

export type ProxyInputCheck =
  | { readonly ok: true; readonly value: ProxyPreference }
  | { readonly ok: false; readonly field: ProxyField };

export const PROXY_MODES: readonly ProxyMode[] = ["system", "direct", "custom"];
export const PROXY_SCHEMES: readonly ProxyScheme[] = ["http", "https", "socks4", "socks5"];
export const PROXY_HOST_MAX = 253;
export const PROXY_BYPASS_MAX_RULES = 64;
export const PROXY_BYPASS_RULE_MAX = 253;
export const PROXY_USERNAME_MAX = 255;
/** 原始输入可含空行与重复项，先按此封顶再规范化，避免超大或稀疏数组拖垮主进程。 */
export const PROXY_BYPASS_RAW_MAX = 256;
/** 应用后校验用的保留域名（.invalid 永不解析）；能命中它的绕过规则在保存时拒收。 */
export const PROXY_CHECK_HOST = "proxy-check.polyask.invalid";
export const PROXY_CHECK_URL = "https://proxy-check.polyask.invalid/";
/** 程序固定追加、用户删不掉的绕过项：不含点的单标签主机名（IE 语义，与 loopback 无关）。 */
export const PROXY_LOCAL_BYPASS = "<local>";
export const PROXY_PASSWORD_MAX = 1024;

const FIELDS = ["version", "mode", "scheme", "host", "port", "bypass", "username"] as const;
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;
const WHITESPACE = /\s/;
const HOST_FORBIDDEN = /[/@?#\\]/;
const BYPASS_FORBIDDEN = /[,;]/;
const CANONICAL_NAME = /^[a-z0-9_.-]+$/;
const PAC_PREFIX: Readonly<Record<ProxyScheme, string>> = { http: "PROXY", https: "HTTPS", socks4: "SOCKS", socks5: "SOCKS5" };

function freezePreference(value: ProxyPreference): ProxyPreference {
  Object.freeze(value.bypass);
  return Object.freeze(value);
}

export const DEFAULT_PROXY_PREFERENCE: ProxyPreference = freezePreference({
  version: 1, mode: "system", scheme: "http", host: "", port: 0, bypass: [], username: ""
});

/** 阻断配置：指向必然拒绝连接的 discard 端口，不带 direct 回退；永远不记为「已应用配置」。 */
export const BLOCKING_PROXY_CONFIG: Readonly<Electron.ProxyConfig> = Object.freeze({
  mode: "fixed_servers", proxyRules: "http://127.0.0.1:9"
});

function isSocks(scheme: ProxyScheme): boolean {
  return scheme === "socks4" || scheme === "socks5";
}

function isIpv6Literal(inner: string): boolean {
  if (!inner.includes(":") || !/^[0-9a-f:.]+$/i.test(inner)) return false;
  try { return new URL(`http://[${inner}]/`).hostname.length > 2; } catch { return false; }
}

/** 第 1 步：原始 host（已去首尾空白）的字符规则。冒号只允许出现在 IPv6 字面量里，所以 host:8080 被拒收。 */
function hostCharsOk(host: string): boolean {
  if (host.length > PROXY_HOST_MAX || WHITESPACE.test(host) || CONTROL.test(host) || HOST_FORBIDDEN.test(host)) return false;
  if (!host.includes(":") && !host.includes("[") && !host.includes("]")) return true;
  const inner = host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
  return isIpv6Literal(inner);
}

/** 规范化之后的 host 只能是 DNS 名字符集或 IPv6 字面量；挡住 `*`、`,`、`;` 之类 URL 解析放行、Chromium 规则会误读的字符。 */
function canonicalHostOk(host: string): boolean {
  return host.includes(":") ? isIpv6Literal(host) : CANONICAL_NAME.test(host);
}

/** 通配匹配：`*` 任意串、`?` 单字符；双指针回溯，O(n·m)，不用正则以免病态规则卡住主进程。 */
function globMatches(pattern: string, value: string): boolean {
  let p = 0, v = 0, star = -1, mark = 0;
  while (v < value.length) {
    if (p < pattern.length && (pattern[p] === "?" || pattern[p] === value[v])) { p++; v++; }
    else if (p < pattern.length && pattern[p] === "*") { star = p++; mark = v; }
    else if (star >= 0) { p = star + 1; v = ++mark; }
    else return false;
  }
  while (p < pattern.length && pattern[p] === "*") p++;
  return p === pattern.length;
}

/**
 * Chromium 绕过规则对一个域名主机的命中判断（子集）：`*`、`*.x`、`.x`（等价 `*.x`）、`x`、含 `*`/`?` 的 glob，
 * 不区分大小写。scheme 前缀与 `:port` 后缀按「不限定」处理——比 Chromium 更宽，只会多拒收，不会漏拒。
 * IP/CIDR 规则（含 `/` 或 `[`）与 `<…>` 特殊规则对域名主机一律不命中。
 */
export function bypassMatchesHost(rule: string, host: string): boolean {
  let pattern = rule.trim().toLowerCase();
  const target = host.trim().toLowerCase();
  if (!pattern || !target || pattern.startsWith("<")) return false;
  const schemeEnd = pattern.indexOf("://");
  if (schemeEnd >= 0) pattern = pattern.slice(schemeEnd + 3);
  if (pattern.includes("/") || pattern.startsWith("[")) return false;
  const colon = pattern.lastIndexOf(":");
  if (colon >= 0) {
    if (!/^\d*$/.test(pattern.slice(colon + 1))) return false;
    pattern = pattern.slice(0, colon);
  }
  if (pattern.startsWith(".")) pattern = `*${pattern}`;
  return pattern.length > 0 && globMatches(pattern, target);
}

function bypassRuleOk(rule: string): boolean {
  return rule.length <= PROXY_BYPASS_RULE_MAX && !WHITESPACE.test(rule) && !CONTROL.test(rule) &&
    !BYPASS_FORBIDDEN.test(rule) && !rule.startsWith("<") && !bypassMatchesHost(rule, PROXY_CHECK_HOST);
}

/** 字段级规则；对原始值与规范值都成立（host/bypass 先去首尾空白再判）。 */
function fieldError(value: ProxyPreference): Exclude<ProxyField, "shape"> | null {
  const host = value.host.trim();
  if (value.mode === "custom" && !host) return "host";
  if (host && !hostCharsOk(host)) return "host";
  const minPort = value.mode === "custom" ? 1 : 0;
  if (!Number.isInteger(value.port) || value.port < minPort || value.port > 65535) return "port";
  const rules = value.bypass.map(rule => rule.trim()).filter(Boolean);
  if (new Set(rules).size > PROXY_BYPASS_MAX_RULES || !rules.every(bypassRuleOk)) return "bypass";
  if (value.username.length > PROXY_USERNAME_MAX || CONTROL.test(value.username)) return "username";
  return null;
}

function canonicalError(value: ProxyPreference): Exclude<ProxyField, "shape"> | null {
  return fieldError(value) ?? (value.host && !canonicalHostOk(value.host) ? "host" : null);
}

/** 结构检查并拷贝成固定字段顺序；字段集合必须恰好 7 个。超长 bypass 在 Array.from 之前拦下。 */
function readShape(raw: unknown): ProxyPreference | "shape" | "bypass" {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return "shape";
  const keys = Object.keys(raw);
  if (keys.length !== FIELDS.length || !FIELDS.every(key => keys.includes(key))) return "shape";
  const record = raw as Record<string, unknown>;
  const { version, mode, scheme, host, port, username } = record;
  const rawBypass = record.bypass;
  if (version !== 1 || !PROXY_MODES.includes(mode as ProxyMode) || !PROXY_SCHEMES.includes(scheme as ProxyScheme)) return "shape";
  if (typeof host !== "string" || typeof port !== "number" || typeof username !== "string" || !Array.isArray(rawBypass)) return "shape";
  if (rawBypass.length > PROXY_BYPASS_RAW_MAX) return "bypass";
  const bypass: unknown[] = Array.from(rawBypass);
  if (!bypass.every(rule => typeof rule === "string")) return "shape";
  return { version: 1, mode: mode as ProxyMode, scheme: scheme as ProxyScheme, host, port, bypass: bypass as string[], username };
}

function normalizeHost(raw: string): string {
  const host = raw.trim().toLowerCase();
  if (!host) return "";
  if (WHITESPACE.test(host) || HOST_FORBIDDEN.test(host)) throw new Error("proxy_invalid");
  if (host.startsWith("[") !== host.endsWith("]")) throw new Error("proxy_invalid");
  const bracketed = host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
  const url = new URL(`http://${bracketed}/`);
  // "[::1]:7890" 这类带端口的写法 URL 能解析，但会把端口悄悄丢掉；一律拒收，不静默截断。
  if (url.port || url.username || url.password) throw new Error("proxy_invalid");
  const parsed = url.hostname;
  return parsed.startsWith("[") && parsed.endsWith("]") ? parsed.slice(1, -1) : parsed;
}

/** 第 2 步：固定字段顺序（sameValue 用 JSON.stringify 比较）；host 为 "" 时原样保留、不做 URL 解析；解析失败会 throw。 */
export function normalizeProxyPreference(value: ProxyPreference): ProxyPreference {
  return {
    version: 1,
    mode: value.mode,
    scheme: value.scheme,
    host: normalizeHost(value.host),
    port: value.port,
    bypass: [...new Set(value.bypass.map(rule => rule.trim()).filter(Boolean))],
    username: isSocks(value.scheme) ? "" : value.username
  };
}

/** 第 3 步：任何输入都不抛；必须已经是规范形式（含字段顺序）。 */
export function isProxyPreference(value: unknown): value is ProxyPreference {
  try {
    const shaped = readShape(value);
    if (typeof shaped === "string" || canonicalError(shaped)) return false;
    if (Object.keys(value as object).join("\u0000") !== FIELDS.join("\u0000")) return false;
    return JSON.stringify(shaped) === JSON.stringify(normalizeProxyPreference(shaped));
  } catch {
    return false;
  }
}

/** IPC 入口：字符级校验 → 规范化 → 校验。失败只报字段名，渲染层自行翻译。 */
export function checkProxyInput(raw: unknown): ProxyInputCheck {
  try {
    const shaped = readShape(raw);
    if (typeof shaped === "string") return { ok: false, field: shaped };
    const early = fieldError(shaped);
    if (early) return { ok: false, field: early };
    let value: ProxyPreference;
    try { value = normalizeProxyPreference(shaped); } catch { return { ok: false, field: "host" }; }
    const late = canonicalError(value);
    if (late) return { ok: false, field: late };
    return isProxyPreference(value) ? { ok: true, value } : { ok: false, field: "shape" };
  } catch {
    return { ok: false, field: "shape" };
  }
}

export function proxyIdentity(value: ProxyPreference | null): ProxyIdentity | null {
  if (!value || value.mode !== "custom") return null;
  return { scheme: value.scheme, host: value.host, port: value.port, username: value.username };
}

export function sameRoute(a: ProxyRoute, b: ProxyRoute): boolean {
  return a.scheme === b.scheme && a.host === b.host && a.port === b.port;
}

/** 两侧都不是 custom（无身份）视为相同；只有一侧有身份视为不同。 */
export function sameIdentity(a: ProxyPreference | null, b: ProxyPreference | null): boolean {
  const left = proxyIdentity(a), right = proxyIdentity(b);
  if (!left || !right) return left === right;
  return sameRoute(left, right) && left.username === right.username;
}

/** 代理规则与 PAC 结果里的主机写法：IPv6 加方括号。 */
export function proxyHostForRules(host: string): string {
  return host.includes(":") ? `[${host}]` : host;
}

/** 只接受已校验的规范值；绕过规则 = 用户列表 + 固定的 `<local>`。 */
export function toProxyConfig(value: ProxyPreference): Electron.ProxyConfig {
  if (value.mode === "system") return { mode: "system" };
  if (value.mode === "direct") return { mode: "direct" };
  return {
    mode: "fixed_servers",
    proxyRules: `${value.scheme}://${proxyHostForRules(value.host)}:${value.port}`,
    proxyBypassRules: [...value.bypass, PROXY_LOCAL_BYPASS].join(",")
  };
}

/** `resolveProxy(PROXY_CHECK_URL)` 的期望值；system 模式不比较（null）。格式以 §9.1-g 实测为准。 */
export function expectedResolve(value: ProxyPreference): string | null {
  if (value.mode === "system") return null;
  if (value.mode === "direct") return "DIRECT";
  return `${PAC_PREFIX[value.scheme]} ${proxyHostForRules(value.host)}:${value.port}`;
}

/** 密码问题（不含「为空」，空由调用方处理）：超长或含 C0/DEL/C1 控制字符。 */
export function proxyPasswordProblem(pw: string): boolean {
  return pw.length > PROXY_PASSWORD_MAX || CONTROL.test(pw);
}
