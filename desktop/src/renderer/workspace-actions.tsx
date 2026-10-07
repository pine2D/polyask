import { useId } from "react";
import { formatCopy, type DesktopCopy } from "../shared/copy";
import type { SyncStatus } from "../shared/sync";
import { ArchiveIcon, CompareIcon, MoreIcon, ReloadIcon } from "./icons";
import { commandHint } from "./command-hint";
import { describeSync, syncNeedsAttention } from "./sync-status";

interface WorkspaceActionsProps {
  readonly copy: DesktopCopy;
  readonly disabled: boolean;
  readonly failureCount: number;
  readonly cancelledCount: number;
  readonly uncertainCount?: number;
  readonly onReviewUncertain?: () => void;
  readonly synthesisPending: boolean;
  readonly syncStatus: SyncStatus;
  readonly onCompare?: () => void;
  readonly onRetry: () => void;
  readonly isMac?: boolean;
  readonly onOpenArchive: () => void;
  readonly onOpenMore: () => void;
}

// F166：重试数量同时显示在按钮正文与可访问名中；更多菜单仅提示剩余待办。
export function WorkspaceActions(props: WorkspaceActionsProps): React.JSX.Element {
  const compareHintId = useId();
  const compareBlocked = props.disabled ? props.copy.compareBusy : !props.onCompare ? props.copy.compareNeedsAnswers : null;
  const syncAttention = syncNeedsAttention(props.syncStatus);
  const retryCount = props.failureCount;
  const uncertainCount = props.uncertainCount ?? props.cancelledCount;
  const attentionCount = (props.synthesisPending ? 1 : 0) + (syncAttention ? 1 : 0);
  const retryLabel = retryCount ? formatCopy(props.copy.retryFailedSites, { count: retryCount }) : null;
  const label = syncAttention
    ? `${props.copy.moreActions}: ${describeSync(props.copy, props.syncStatus)}`
    : props.copy.moreActions;
  return (
    <div className="workspace-actions priority-p0">
      {retryLabel ? <button type="button" className="retry-trigger"
        data-hint={commandHint(retryLabel, "retry-failed", props.isMac)} aria-label={retryLabel}
        disabled={props.disabled} onClick={props.onRetry}>
        <ReloadIcon /><span><span className="retry-label">{props.copy.retryCompact} · </span>{retryCount}</span>
      </button> : null}
      {uncertainCount ? <button type="button" className="uncertain-retry-trigger" disabled={props.disabled}
        aria-label={formatCopy(props.copy.retryReviewAction, {count: uncertainCount})}
        data-hint={formatCopy(props.copy.retryReviewAction, {count: uncertainCount})} onClick={props.onReviewUncertain}>
        <span>{props.copy.retryReviewCompact}</span><span>{uncertainCount}</span>
      </button> : null}
      <button type="button" className="compare-trigger" data-hint={compareBlocked ?? props.copy.collectCompare}
        aria-label={props.copy.collectCompare} aria-disabled={!!compareBlocked}
        aria-describedby={compareBlocked ? compareHintId : undefined} onClick={compareBlocked ? undefined : props.onCompare}>
        <CompareIcon />
      </button>
      {compareBlocked ? <span id={compareHintId} className="sr-only">{compareBlocked}</span> : null}
      <button type="button" className="archive-trigger" data-hint={props.disabled ? props.copy.archiveBusy : props.copy.openArchive}
        aria-label={props.copy.openArchive} aria-disabled={props.disabled} onClick={props.disabled ? undefined : props.onOpenArchive}>
        <ArchiveIcon />
      </button>
      <button
        type="button"
        className={syncAttention ? `more-trigger sync-attention sync-${props.syncStatus.state}` : "more-trigger"}
        data-hint={label}
        aria-label={label}
        aria-haspopup="menu"
        data-attention-count={attentionCount || undefined}
        data-sync-state={syncAttention ? props.syncStatus.state : undefined}
        disabled={props.disabled}
        onClick={props.onOpenMore}
      ><MoreIcon /></button>
    </div>
  );
}
