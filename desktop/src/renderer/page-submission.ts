import { formatCopy, type DesktopCopy } from "../shared/copy";
import type { SiteKey } from "../shared/contracts";
import { isPageLoadFailure, type SitePhase, type SiteStatus, type SubmissionStatus } from "../shared/protocol";
import { describeStatus } from "../shared/status-copy";

export const SUBMISSION_BADGES = [
  { state: "sending", symbol: "…", copyKey: "sitePageSending" },
  { state: "sent", symbol: "✓", copyKey: "sitePageSent" },
  { state: "failed", symbol: "×", copyKey: "sitePageFailed" },
  { state: "unconfirmed", symbol: "?", copyKey: "sitePageUnconfirmed" },
  { state: "cancelled", symbol: "−", copyKey: "sitePageCancelled" }
] as const;

/** 图标化页签只留一枚徽标时按此顺序取最需要处理的状态。 */
const BADGE_SEVERITY: readonly SubmissionStatus["state"][] = ["failed", "unconfirmed", "sending", "cancelled", "sent"];

export function primarySubmissionState(states: readonly SubmissionStatus["state"][]): SubmissionStatus["state"] | null {
  return BADGE_SEVERITY.find(state => states.includes(state)) ?? null;
}

export function pageSubmissionSummary(sites: readonly SiteKey[], statuses: Readonly<Record<string, SiteStatus>>, copy: DesktopCopy) {
  return SUBMISSION_BADGES.map(badge => ({ ...badge,
    count: sites.filter(site => statuses[site]?.submission?.state === badge.state).length
  })).filter(badge => badge.count > 0).map(badge => ({ ...badge,
    label: formatCopy(copy[badge.copyKey], { count: badge.count })
  }));
}

export function pageSiteDetail(name: string, status: SiteStatus | undefined, copy: DesktopCopy): string {
  const submission = status?.submission;
  const phases: Record<SubmissionStatus["state"], SitePhase> = {
    sending: "sending", sent: "submitted", failed: "failed",
    unconfirmed: "failed", cancelled: "cancelled"
  };
  const details = [submission && status ? describeStatus(copy, {
    site: status.site, phase: phases[submission.state],
    code: submission.code ?? (submission.state === "unconfirmed" ? "submit_unconfirmed" : undefined),
    selection: submission.selection, submissionEvidence: submission.submissionEvidence
  }) : copy.sitePageNotSent];
  if (status && (status.phase === "generating" || status.phase === "complete" || status.phase === "crashed" || isPageLoadFailure(status.code)))
    details.push(describeStatus(copy, { site: status.site, phase: status.phase, code: status.code }));
  return `${name}: ${[...new Set(details)].join(" · ")}`;
}
