import { formatCopy, type DesktopCopy } from "../shared/copy";
import type { SiteKey } from "../shared/contracts";
import type { SiteStatus, SubmissionStatus } from "../shared/protocol";
import { describeStatus } from "../shared/status-copy";

export const SUBMISSION_BADGES = [
  { state: "sending", symbol: "…", copyKey: "sitePageSending" },
  { state: "sent", symbol: "✓", copyKey: "sitePageSent" },
  { state: "failed", symbol: "×", copyKey: "sitePageFailed" },
  { state: "unconfirmed", symbol: "?", copyKey: "sitePageUnconfirmed" },
  { state: "cancelled", symbol: "−", copyKey: "sitePageCancelled" }
] as const;

export function pageSubmissionSummary(sites: readonly SiteKey[], statuses: Readonly<Record<string, SiteStatus>>, copy: DesktopCopy) {
  return SUBMISSION_BADGES.map(badge => ({ ...badge,
    count: sites.filter(site => statuses[site]?.submission?.state === badge.state).length
  })).filter(badge => badge.count > 0).map(badge => ({ ...badge,
    label: formatCopy(copy[badge.copyKey], { count: badge.count })
  }));
}

export function pageSiteDetail(name: string, status: SiteStatus | undefined, copy: DesktopCopy): string {
  const submission = status?.submission;
  const labels: Record<SubmissionStatus["state"], string> = {
    sending: copy.sending, sent: copy.submitted, failed: copy.failed,
    unconfirmed: copy.submitUnconfirmed, cancelled: copy.cancelledStatus
  };
  const details = [submission ? labels[submission.state] : copy.sitePageNotSent];
  if (submission?.code && status) details.push(describeStatus(copy, { ...status, code: submission.code }));
  if (status && (status.phase === "generating" || status.phase === "complete" || status.phase === "crashed" || status.code === "load_failed"))
    details.push(describeStatus(copy, status));
  return `${name}: ${[...new Set(details)].join(" · ")}`;
}
