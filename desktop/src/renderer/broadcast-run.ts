import type { SiteKey } from "../shared/contracts";
import type { BroadcastRequest, SiteRunResult, SubmissionStatus } from "../shared/protocol";
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
    return result?.ok === false && !!result.code && PRE_SUBMIT_FAILURES.has(result.code);
  });
}

// 只收目前明确发生在提交动作前的失败；新增/缺失回包不能被推断为「未发送」。
const PRE_SUBMIT_FAILURES = new Set([
  "composer_not_found", "not_ready", "inject_failed", "no_view", "load_failed", "image_invalid",
  "attachment_unsupported", "attachment_failed", "attachment_timeout", "attachment_action_required",
  "attachment_conflict", "adapter_unavailable"
]);

export function uncertainRunSites(run: BroadcastRun): SiteKey[] {
  // 取消可能发生在站点已提交、确认回包尚未到达时；没有可靠的提交前阶段证据。
  const known = new Set(failedRunSites(run));
  return run.request.sites.filter(site => run.results.get(site)?.ok !== true && !known.has(site));
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

// 同轮可信 sent 状态优先于缺失/不确定回包；这里只收证据，不触发发送。
export function acceptSubmissionEvidence(run: BroadcastRun, site: SiteKey, submission: SubmissionStatus): BroadcastRun {
  if (submission.state !== "sent" || run.request.runId !== submission.runId || !uncertainRunSites(run).includes(site)) return run;
  const previous = run.results.get(site);
  const metadata = { ...normalizeSelectionMetadata(previous), ...normalizeSelectionMetadata(submission) };
  // 旧迟到确认协议只针对 submit_unconfirmed，证据来自页面上的本轮用户消息。
  if (!metadata.submissionEvidence && previous?.code === "submit_unconfirmed") metadata.submissionEvidence = "message";
  const results = new Map(run.results);
  results.set(site, { site, ok: true, ...metadata,
    ...(metadata.selection?.outcome === "unconfirmed" ? { code: "tier_unconfirmed" } : {}) });
  return { request: run.request, results };
}

export function retryRequest(
  run: BroadcastRun, selected?: SiteKey | readonly SiteKey[], uncertainConfirmed = false
): BroadcastRequest | null {
  const choices = selected === undefined ? null : new Set(typeof selected === "string" ? [selected] : selected);
  const allowed = new Set([...failedRunSites(run),
    ...(uncertainConfirmed && choices ? uncertainRunSites(run) : [])]);
  const sites = run.request.sites.filter(site => (!choices || choices.has(site)) && allowed.has(site));
  return sites.length ? { ...run.request, sites } : null;
}

export function runCoversSites(run: BroadcastRun, sites: readonly SiteKey[]): boolean {
  return sites.length > 0 && sites.every((site) => run.request.sites.includes(site));
}
