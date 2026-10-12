import type { SiteKey } from "./contracts";
import type { SiteStatus } from "./protocol";
import type { SiteHealth } from "./site-health";
import { normalizeProcessFailure, type RuntimeProcessFailure } from "./runtime-process";
import { CAPTURE_LOCATES, CAPTURE_REASONS, type CaptureLocateCounts } from "./question-capture";
import { PROXY_MODES, PROXY_SCHEMES } from "./proxy-preference";

/** 与 main/proxy-auth.ts 的 ProxySecretState 同集；test/site-report.test.ts 用类型对账防漂移。 */
export const REPORT_PROXY_SECRET_STATES = ["unknown", "saved", "memory", "mismatch", "unreadable", "none"] as const;

/**
 * proxy-state 载荷里报告要读的字段（结构类型，ProxyRuntimeState 直接满足）。
 * 只取枚举与布尔：host、port、username 原文、bypass、pendingConfirm 的内容一概不读出。
 */
export interface SiteReportProxyState {
  readonly formValue: { readonly mode: string; readonly scheme: string; readonly username: string };
  readonly following: boolean;
  readonly appliedResult: string;
  readonly stored: string;
  readonly pending: boolean;
  readonly pendingConfirm: object | null;
  readonly secret: string;
}

export interface SiteReportInput {
  readonly version: string;
  readonly distribution: string;
  readonly platform: string;
  readonly scale: number;
  readonly sites: readonly { readonly key: SiteKey; readonly label: string }[];
  readonly statuses: Readonly<Partial<Record<string, SiteStatus>>>;
  readonly health: Readonly<Partial<Record<SiteKey, SiteHealth>>>;
  readonly now: number;
  readonly processFailures?: readonly RuntimeProcessFailure[];
  readonly captureLocate?: CaptureLocateCounts;
  readonly proxy?: SiteReportProxyState | null;
}

// 采集定位记账白名单行：只认三种定位级别与非负安全整数，其余（未知键、文本、负数）一律丢弃。
function captureLocateLine(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const parts = CAPTURE_LOCATES.flatMap((locate) => {
    const count = row[locate];
    return Number.isSafeInteger(count) && (count as number) > 0 ? [`${locate}=${count}`] : [];
  });
  return parts.length ? `  capture-locate ${parts.join(" ")}` : null;
}

function captureReasonLine(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const row = (value as Record<string, unknown>).reasons;
  if (!row || typeof row !== "object") return null;
  const parts = CAPTURE_REASONS.flatMap(reason => {
    const count = (row as Record<string, unknown>)[reason];
    return Number.isSafeInteger(count) && (count as number) > 0 ? [`${reason}=${count}`] : [];
  });
  return parts.length ? `  capture-reason ${parts.join(" ")}` : null;
}

// 卡顿回调计数白名单行：只认正的安全整数。
function slowObserverLine(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const count = (value as Record<string, unknown>).slowObserver;
  return Number.isSafeInteger(count) && (count as number) > 0 ? `  capture-slow-observer ${count}` : null;
}

function pickEnum(value: unknown, allowed: readonly string[]): string | null {
  return typeof value === "string" && allowed.includes(value) ? value : null;
}

function yesNo(value: unknown): string | null {
  return value === true ? "yes" : value === false ? "no" : null;
}

// 代理白名单行：mode/scheme/auth 描述 formValue（本机 override 或跟随时的 target），applied 说明是否生效。
// mode 不合法时整行丢弃；其余字段逐个校验，不合法只省略该字段。auth 只说有没有用户名，不写用户名本身。
function proxyLine(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const state = value as Record<string, unknown>;
  const form = state.formValue && typeof state.formValue === "object" ? state.formValue as Record<string, unknown> : null;
  const mode = form ? pickEnum(form.mode, PROXY_MODES) : null;
  if (!form || !mode) return null;
  const auth = typeof form.username === "string" ? (mode === "custom" && form.username !== "" ? "yes" : "no") : null;
  const confirm = state.pendingConfirm === null ? "no"
    : state.pendingConfirm && typeof state.pendingConfirm === "object" ? "yes" : null;
  const fields: readonly (readonly [string, string | null])[] = [
    ["mode", mode],
    ["scheme", mode === "custom" ? pickEnum(form.scheme, PROXY_SCHEMES) : null],
    ["auth", auth],
    ["secret", pickEnum(state.secret, REPORT_PROXY_SECRET_STATES)],
    ["following", yesNo(state.following)],
    ["applied", pickEnum(state.appliedResult, ["ok", "proxy_apply_failed"])],
    ["pending", yesNo(state.pending)],
    ["confirm", confirm],
    ["stored", pickEnum(state.stored, ["ok", "invalid"])]
  ];
  return `proxy ${fields.flatMap(([name, field]) => field === null ? [] : [`${name}=${field}`]).join(" ")}`;
}

// 可直接粘贴进报障 issue 的纯文本报告：版本 / 环境 / 显示缩放，代理枚举行，每站的 phase、code、健康结论，
// 每条 check 的 {name, kind, ok}，白名单进程类别/退出原因/数值错误码，以及每站采集定位级别与卡顿回调的计数。绝不包含对话内容、URL、账号信息——check.name 是本地化的
// diag_* 词条，不是页面文本；站点只写 key 与产品名，不写 host；代理不写主机、端口、用户名与绕过列表。
export function buildSiteReport(input: SiteReportInput): string {
  const lines = [
    `PolyAsk Desktop ${input.version} (${input.distribution}) · ${input.platform} · scale ${input.scale}`,
    `generated ${new Date(input.now).toISOString()}`
  ];
  const proxy = proxyLine(input.proxy);
  if (proxy) lines.push(proxy);
  for (const raw of (input.processFailures ?? []).slice(0, 7)) {
    const failure = normalizeProcessFailure(raw);
    if (!failure) continue;
    lines.push(`runtime [${failure.processType}]: reason=${failure.reason}`
      + (failure.exitCode !== undefined ? ` exitCode=${failure.exitCode}` : "")
      + (failure.systemErrorCode !== undefined ? ` systemErrorCode=${failure.systemErrorCode}` : ""));
  }
  for (const site of input.sites) {
    const status = input.statuses[site.key];
    const health = input.health[site.key];
    const phase = status ? `phase=${status.phase}${status.code ? ` code=${status.code}` : ""}` : "phase=unknown";
    const checked = health?.checkedAt ? ` checkedAt=${new Date(health.checkedAt).toISOString()}` : "";
    lines.push(`[${site.key}] ${site.label}: ${phase} health=${health?.state ?? "unknown"}${checked}`);
    const checks = health?.checks ?? [];
    if (!checks.length) lines.push("  - (no checks)");
    for (const check of checks) lines.push(`  - ${check.name} kind=${check.kind ?? "control"} ok=${check.ok}`);
    const locate = captureLocateLine(input.captureLocate?.[site.key]);
    if (locate) lines.push(locate);
    const reason = captureReasonLine(input.captureLocate?.[site.key]);
    if (reason) lines.push(reason);
    const slow = slowObserverLine(input.captureLocate?.[site.key]);
    if (slow) lines.push(slow);
  }
  return lines.join("\n");
}
