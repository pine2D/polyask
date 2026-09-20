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
  const retryCount = props.failureCount + props.cancelledCount;
  const attentionCount = (props.synthesisPending ? 1 : 0) + (syncAttention ? 1 : 0);
  const retryLabel = !retryCount ? null
    : props.failureCount && props.cancelledCount ? formatCopy(props.copy.retryFailedOrCancelledSites, { count: retryCount })
    : props.cancelledCount ? formatCopy(props.copy.retryCancelledSites, { count: retryCount })
    : formatCopy(props.copy.retryFailedSites, { count: retryCount });
  const label = syncAttention
    ? `${props.copy.moreActions}: ${describeSync(props.copy, props.syncStatus)}`
    : props.copy.moreActions;
  return (
    <div className="workspace-actions priority-p0">
      {retryLabel ? <button type="button" className="retry-trigger"
        title={commandHint(retryLabel, "retry-failed", props.isMac)} aria-label={retryLabel}
        disabled={props.disabled} onClick={props.onRetry}>
        <ReloadIcon /><span>{props.copy.retryCompact} · {retryCount}</span>
      </button> : null}
      <button type="button" className="compare-trigger" title={compareBlocked ?? props.copy.collectCompare}
        aria-label={props.copy.collectCompare} aria-disabled={!!compareBlocked}
        aria-describedby={compareBlocked ? compareHintId : undefined} onClick={compareBlocked ? undefined : props.onCompare}>
        <CompareIcon /><span className="priority-p1">{props.copy.collectCompare}</span>
      </button>
      {compareBlocked ? <span id={compareHintId} className="sr-only">{compareBlocked}</span> : null}
      <button type="button" className="archive-trigger" title={props.copy.openArchive}
        aria-label={props.copy.openArchive} disabled={props.disabled} onClick={props.onOpenArchive}>
        <ArchiveIcon /><span className="priority-p1">{props.copy.archiveTitle}</span>
      </button>
      <button
        type="button"
        className={syncAttention ? `more-trigger sync-attention sync-${props.syncStatus.state}` : "more-trigger"}
        title={label}
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
