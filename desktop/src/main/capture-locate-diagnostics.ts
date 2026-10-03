import type { SiteKey } from "../shared/contracts";
import { CAPTURE_LOCATES, isCaptureLocate, type CaptureLocate, type CaptureLocateCounts } from "../shared/question-capture";

// 每个站点、每种定位级别各归属了几轮提问（每轮只记一次）。只在主进程内存里，随进程退出清零；
// 不落库、不同步、不含任何内容，只供「复制诊断报告」看出哪站已在靠 ②③ 级兜底。
export class CaptureLocateDiagnostics {
  private readonly counts = new Map<SiteKey, Map<CaptureLocate, number>>();
  record(site: SiteKey, locate: unknown): void {
    if (!isCaptureLocate(locate)) return;
    const row = this.counts.get(site) ?? new Map<CaptureLocate, number>();
    row.set(locate, Math.min(Number.MAX_SAFE_INTEGER, (row.get(locate) ?? 0) + 1));
    this.counts.set(site, row);
  }
  snapshot(): CaptureLocateCounts {
    const result: CaptureLocateCounts = {};
    for (const [site, row] of this.counts) {
      result[site] = Object.fromEntries(CAPTURE_LOCATES.filter(locate => row.has(locate)).map(locate => [locate, row.get(locate)!]));
    }
    return result;
  }
  clear(): void { this.counts.clear(); }
}

export const captureLocateDiagnostics = new CaptureLocateDiagnostics();
