import type { SiteKey } from "../shared/contracts";
import type { SiteRunResult, SiteStatus } from "../shared/protocol";
import { normalizeSelectionMetadata } from "../shared/selection";
import type { QuestionHistoryService } from "./question-history-service";
import type { QuestionCaptureService } from "./question-capture-service";

/** 迟到确认只用到的外壳能力：读状态、改状态、开生成监视。刻意不含 sendCommand / confirmSubmitted——这条路径不发送。 */
export interface SubmissionUpgradeTarget {
  getStatuses(): SiteStatus[];
  markStatus(status: SiteStatus): void;
  watchGeneration(runId: string, site: SiteKey): void;
}

// 档位未确认照常带 tier_unconfirmed（与正常成功路径、Kimi 只读确认路径同一写法），升级不得把这条警示丢掉。
function sentMetadata(value: unknown) {
  const { selection } = normalizeSelectionMetadata(value);
  return { ...(selection ? { selection } : {}), submissionEvidence: "message" as const,
    ...(selection?.outcome === "unconfirmed" ? { code: "tier_unconfirmed" } : {}) };
}

/**
 * 「提交未确认」→「已发送」的状态。只认同一 runId、且外壳此刻仍停在 unconfirmed 的站：
 * 用户已重试（sending）、已取消、已开新一轮（submission 被清掉）或已经是 sent 的一律不动（只升不降）。
 */
export function upgradedSubmissionStatus(previous: SiteStatus | undefined, runId: string): SiteStatus | null {
  const submission = previous?.submission;
  if (!previous || !submission || submission.runId !== runId || submission.state !== "unconfirmed") return null;
  const metadata = sentMetadata(submission);
  return { site: previous.site, phase: metadata.code ? "warning" : "submitted", ...metadata,
    submission: { runId, state: "sent", ...metadata } };
}

/**
 * 提问历史已凭归属快照（非锚点）确认本轮用户消息出现在页面上：改外壳状态（重试入口随之消失），
 * 再开本站的生成监视，让收口与封存照常走。只读、只升；绝不调用任何发送或重发。
 */
export function upgradeSubmission(target: SubmissionUpgradeTarget, runId: string, site: SiteKey): boolean {
  const status = upgradedSubmissionStatus(target.getStatuses().find(item => item.site === site), runId);
  if (!status) return false;
  target.markStatus(status);
  target.watchGeneration(runId, site);
  return true;
}

/**
 * 同 runId 重试前的最后一道闸：重试开始时的采集 flush 可能刚凭归属快照把本站升为已发送。
 * 这样的站不得再派发（同一个问题会被问两遍），直接回「已发送」结果；其余站返回 null 照常重试。
 */
export function lateSentResult(target: Pick<SubmissionUpgradeTarget, "getStatuses">, runId: string) {
  return (site: SiteKey): SiteRunResult | null => {
    const submission = target.getStatuses().find(item => item.site === site)?.submission;
    if (submission?.runId !== runId || submission.state !== "sent") return null;
    return { site, ok: true, ...sentMetadata(submission) };
  };
}

/**
 * 用户取消：发送中的站作废本次尝试；已回包「提交未确认」的站保留采集，但不再迟到升级（用户已叫停这一轮）。
 * 返回发送中的站，交给生成监视一并取消。
 */
export function cancelSubmissions(statuses: readonly SiteStatus[], questions: QuestionHistoryService, capture?: Pick<QuestionCaptureService, "cancelPreparation">): SiteKey[] {
  capture?.cancelPreparation();
  const sending = statuses.filter(status => status.phase === "sending").map(status => status.site);
  questions.cancel(sending);
  questions.holdSubmission(statuses.filter(status => status.submission?.state === "unconfirmed").map(status => status.site));
  return sending;
}
