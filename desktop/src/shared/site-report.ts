import type { SiteKey } from "./contracts";
import type { SiteStatus } from "./protocol";
import type { SiteHealth } from "./site-health";
import { normalizeProcessFailure, type RuntimeProcessFailure } from "./runtime-process";
import { CAPTURE_LOCATES, type CaptureLocateCounts } from "./question-capture";

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

// 卡顿回调计数白名单行：只认正的安全整数。
function slowObserverLine(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const count = (value as Record<string, unknown>).slowObserver;
  return Number.isSafeInteger(count) && (count as number) > 0 ? `  capture-slow-observer ${count}` : null;
}

// 可直接粘贴进报障 issue 的纯文本报告：版本 / 环境 / 显示缩放，每站的 phase、code、健康结论，
// 每条 check 的 {name, kind, ok}，白名单进程类别/退出原因/数值错误码，以及每站采集定位级别与卡顿回调的计数。绝不包含对话内容、URL、账号信息——check.name 是本地化的
// diag_* 词条，不是页面文本；站点只写 key 与产品名，不写 host。
export function buildSiteReport(input: SiteReportInput): string {
  const lines = [
    `PolyAsk Desktop ${input.version} (${input.distribution}) · ${input.platform} · scale ${input.scale}`,
    `generated ${new Date(input.now).toISOString()}`
  ];
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
    const slow = slowObserverLine(input.captureLocate?.[site.key]);
    if (slow) lines.push(slow);
  }
  return lines.join("\n");
}
