import type { SiteKey } from "../shared/contracts";
import type { BroadcastRequest, SiteRunResult } from "../shared/protocol";
import { normalizeSelectionMetadata } from "../shared/selection";

export interface BroadcastRun {
  readonly request: BroadcastRequest;
  readonly results: ReadonlyMap<SiteKey, SiteRunResult>;
}

export function completeRun(
  request: BroadcastRequest,
  results: readonly SiteRunResult[]
): BroadcastRun {
  return {
    request,
    results: new Map(
      results
        .filter((result) => request.sites.includes(result.site))
        .map((result) => [result.site, result])
    )
  };
}

export function mergeRunResults(
  run: BroadcastRun,
  results: readonly SiteRunResult[]
): BroadcastRun {
  const merged = new Map(run.results);
  for (const result of results) {
    if (run.request.sites.includes(result.site)) merged.set(result.site, result);
  }
  return { request: run.request, results: merged };
}

export function failedRunSites(run: BroadcastRun): SiteKey[] {
  return run.request.sites.filter((site) => {
    const result = run.results.get(site);
    return result?.ok === false && result.code !== "cancelled";
  });
}

export function cancelledRunSites(run: BroadcastRun): SiteKey[] {
  return run.request.sites.filter((site) => {
    const result = run.results.get(site);
    return result?.ok === false && result.code === "cancelled";
  });
}

// 主进程迟到确认（提交未确认 → 页面上已看到本轮提问）经状态通道送来同 runId 的 state:"sent"。
// 只升不降：只有该站结果仍是 submit_unconfirmed 才改成已发送，重试入口随之消失；其它失败码、别的 runId 一律不动。
export function acceptLateSubmission(run: BroadcastRun, site: SiteKey, runId: string): BroadcastRun {
  const result = run.results.get(site);
  if (run.request.runId !== runId || result?.ok !== false || result.code !== "submit_unconfirmed") return run;
  const results = new Map(run.results);
  const { selection } = normalizeSelectionMetadata(result);
  // 档位未确认照常带 tier_unconfirmed（与主进程状态、正常成功路径一致）。
  results.set(site, { ...(selection ? { selection } : {}), site, ok: true, submissionEvidence: "message",
    ...(selection?.outcome === "unconfirmed" ? { code: "tier_unconfirmed" } : {}) });
  return { request: run.request, results };
}

export function retryRequest(run: BroadcastRun, onlySite?: SiteKey): BroadcastRequest | null {
  const sites = run.request.sites.filter((site) => (!onlySite || site === onlySite) && run.results.get(site)?.ok === false);
  return sites.length ? { ...run.request, sites } : null;
}

export function runCoversSites(run: BroadcastRun, sites: readonly SiteKey[]): boolean {
  return sites.length > 0 && sites.every((site) => run.request.sites.includes(site));
}
