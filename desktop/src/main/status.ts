import type { SiteKey } from "../shared/contracts";
import type { SiteResult, SiteStatus, SubmissionStatus } from "../shared/protocol";

export function statusForResult(site: SiteKey, result: SiteResult, runId?: string): SiteStatus {
  const submission: SubmissionStatus | undefined = runId ? {
    runId, state: result.ok ? "sent" : result.code === "cancelled" ? "cancelled"
      : result.code === "submit_unconfirmed" ? "unconfirmed" : "failed",
    ...(result.code ? { code: result.code } : {})
  } : undefined;
  const metadata = submission ? { submission } : {};
  if (!result.ok && result.code === "cancelled") {
    return { ...metadata, site, phase: "cancelled", code: "cancelled" };
  }
  if (!result.ok) {
    return { ...metadata, site, phase: "failed", ...(result.code ? { code: result.code } : {}) };
  }
  if (result.code) return { ...metadata, site, phase: "warning", code: result.code };
  return { ...metadata, site, phase: "submitted" };
}

export function effectiveStatus(
  runStatus: SiteStatus | undefined,
  pageStatus: SiteStatus
): SiteStatus {
  if (pageStatus.phase === "failed" || pageStatus.phase === "crashed")
    return runStatus?.submission ? { ...pageStatus, submission: runStatus.submission } : pageStatus;
  return runStatus ?? pageStatus;
}

export function statusWithUnread(status: SiteStatus, visible: boolean): SiteStatus {
  const terminal = status.phase === "complete" || status.phase === "failed" || status.phase === "crashed";
  return terminal ? { ...status, unread: !visible } : status;
}

export function markStatusRead(status: SiteStatus): SiteStatus {
  return status.unread ? { ...status, unread: false } : status;
}

export function statusForSending(site: SiteKey, runId: string): SiteStatus {
  return { site, phase: "sending", submission: { runId, state: "sending" } };
}

export function preserveSubmission(previous: SiteStatus | undefined, next: SiteStatus): SiteStatus {
  return previous?.submission && (next.phase === "generating" || next.phase === "complete")
    ? { ...next, submission: previous.submission } : next;
}

// 新一轮清除上轮统计；同 runId 的失败子集重试保留其他站的结果。
export function beginSubmissionRun(resumed: boolean, statuses: Map<SiteKey, SiteStatus>, publish: (site: SiteKey) => void): boolean {
  if (!resumed) for (const [site, status] of statuses) {
    if (!status.submission) continue;
    const { submission: _, ...rest } = status;
    statuses.set(site, rest);
    publish(site);
  }
  return resumed;
}
