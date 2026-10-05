import type { SiteKey } from "../shared/contracts";
import { CAPTURE_LOCATES, isCaptureLocate, type CaptureLocate, type CaptureLocateCounts, type CaptureLocateRow } from "../shared/question-capture";

// 每个站点、每种定位级别各归属了几轮提问（每轮只记一次），以及站点运行时报来的卡顿回调次数。只在主进程内存里，
// 随进程退出清零；不落库、不同步、不含任何内容，只供「复制诊断报告」看出哪站已在靠 ②③ 级兜底、哪站观察器在卡。
export class CaptureLocateDiagnostics {
  private readonly counts = new Map<SiteKey, Map<CaptureLocate, number>>();
  // 卡顿回调：站点按轮次报累计值，同一轮反复上报只记增量；换轮（token 变）整笔计入。只留每站最近一轮，内存 O(站点数)。
  private readonly slow = new Map<SiteKey, { token: string; count: number; total: number }>();
  record(site: SiteKey, locate: unknown): void {
    if (!isCaptureLocate(locate)) return;
    const row = this.counts.get(site) ?? new Map<CaptureLocate, number>();
    row.set(locate, Math.min(Number.MAX_SAFE_INTEGER, (row.get(locate) ?? 0) + 1));
    this.counts.set(site, row);
  }
  recordSlow(site: SiteKey, token: unknown, count: unknown): void {
    if (typeof token !== "string" || !token || !Number.isSafeInteger(count) || (count as number) <= 0) return;
    const previous = this.slow.get(site);
    const same = previous?.token === token;
    const delta = same ? Math.max(0, (count as number) - previous.count) : count as number;
    this.slow.set(site, { token, count: same ? Math.max(previous.count, count as number) : count as number,
      total: Math.min(Number.MAX_SAFE_INTEGER, (previous?.total ?? 0) + delta) });
  }
  snapshot(): CaptureLocateCounts {
    const result: CaptureLocateCounts = {};
    for (const site of new Set([...this.counts.keys(), ...this.slow.keys()])) {
      const row = this.counts.get(site);
      const locates: CaptureLocateRow = row
        ? Object.fromEntries(CAPTURE_LOCATES.filter(locate => row.has(locate)).map(locate => [locate, row.get(locate)!])) : {};
      const slow = this.slow.get(site)?.total;
      result[site] = slow ? { ...locates, slowObserver: slow } : locates;
    }
    return result;
  }
  clear(): void { this.counts.clear(); this.slow.clear(); }
}

export const captureLocateDiagnostics = new CaptureLocateDiagnostics();
