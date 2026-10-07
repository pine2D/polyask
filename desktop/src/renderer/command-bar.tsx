import type { ReactNode, RefObject } from "react";

import { formatCopy, type DesktopCopy } from "../shared/copy";
import type { Tier } from "../shared/protocol";
import type { SyncStatus } from "../shared/sync";
import { ChevronDownIcon, FocusIcon, GridIcon, HealthIcon, HistoryIcon, SendIcon, StopIcon } from "./icons";
import { commandHint } from "./command-hint";
import { PromptComposer } from "./prompt-composer";
import { TierControls } from "./tier-controls";
import type { WorkspacePanelTab } from "./workspace-panel-state";
import { WorkspaceActions } from "./workspace-actions";

export type RunState = "idle" | "sending" | "cancelling";

interface CommandBarProps {
  readonly copy: DesktopCopy;
  readonly promptRef: RefObject<HTMLTextAreaElement | null>;
  readonly text: string;
  readonly draftRevision?: number;
  readonly tier: Tier;
  readonly runState: RunState;
  readonly auxiliaryBusy: boolean;
  readonly automaticFocus?: boolean;
  readonly layoutMode: "overview" | "focus";
  readonly selectedCount: number;
  readonly failureCount: number;
  readonly cancelledCount: number;
  readonly uncertainCount?: number;
  readonly onReviewUncertain?: () => void;
  readonly scopeLabel: string;
  readonly healthAttention: number;
  readonly panelTab: WorkspacePanelTab | null;
  readonly pageControl?: ReactNode;
  readonly imageControl: ReactNode;
  readonly sendBlockedReason: string | null;
  readonly synthesisPending: boolean;
  readonly syncStatus: SyncStatus;
  readonly isMac: boolean;
  readonly expanded: boolean;
  readonly onTextChange: (value: string) => void;
  readonly onOpenHistory?: () => void;
  readonly historyOpen?: boolean;
  readonly onSubmit: () => void;
  readonly onCompare?: () => void;
  readonly onRetry: () => void;
  readonly onCancel: () => void;
  readonly onTierChange: (value: Tier) => void;
  readonly onLayoutChange: (value: "overview" | "focus") => void;
  readonly onExpandedChange: (value: boolean) => void;
  readonly onPanelChange: (tab: WorkspacePanelTab | null) => void;
  readonly onShowGroupMenu: () => void;
  readonly onOpenMore: () => void;
  readonly onOpenArchive: () => void;
  readonly onPasteImages: (files: readonly File[]) => void;
}

export function CommandBar(props: CommandBarProps): React.JSX.Element {
  const busy = props.runState !== "idle" || props.auxiliaryBusy;
  const sendLabel = formatCopy(props.selectedCount === 1 ? props.copy.sendToOneSite : props.copy.sendToSites, { count: props.selectedCount });
  const cancelLabel = props.runState === "cancelling" ? props.copy.cancelling : props.copy.cancel;
  const workbenchOpen = props.panelTab !== null;
  const healthOpen = props.panelTab === "health";

  return (
    <header className={`command-bar${props.pageControl ? " has-pages" : ""}${props.expanded ? " is-expanded" : ""}`} aria-label={props.copy.broadcastLabel}>
      <div className="workspace-entry priority-p0">
        <div className="scope-split">
          <button type="button" className="scope-main" data-hint={workbenchOpen ? props.copy.closeWorkbench : commandHint(props.scopeLabel, "open-sites", props.isMac)} aria-label={workbenchOpen ? props.copy.closeWorkbench : props.scopeLabel} aria-expanded={workbenchOpen} aria-controls="workspace-panel" onClick={() => props.onPanelChange(workbenchOpen ? null : "sites")}>
            <span className="scope-label-full">{props.scopeLabel}</span>
            <span className="scope-label-compact">{props.copy.sitesCompact} · {props.selectedCount}</span>
          </button>
          <button type="button" className="scope-menu" data-hint={props.copy.chooseSavedGroup} aria-label={props.copy.chooseSavedGroup} aria-haspopup="menu" onClick={props.onShowGroupMenu}><ChevronDownIcon /></button>
        </div>
        <button type="button" className={healthOpen ? "health-trigger active" : "health-trigger"} data-hint={healthOpen ? props.copy.closeWorkbench : commandHint(props.copy.siteHealth, "open-site-health", props.isMac)} aria-label={healthOpen ? props.copy.closeWorkbench : props.copy.siteHealth} aria-pressed={healthOpen} aria-controls="workspace-panel" data-health-attention={props.healthAttention || undefined} onClick={() => props.onPanelChange(healthOpen ? null : "health")}><HealthIcon /></button>
      </div>
      <div className="mode-switch priority-p0" aria-label={props.copy.layoutLabel}>
        <button type="button" data-hint={props.copy.overview} aria-pressed={props.layoutMode === "overview"} className={props.layoutMode === "overview" ? "active" : ""} onClick={() => props.onLayoutChange("overview")}><GridIcon /><span className="priority-p1">{props.copy.overview}</span></button>
        <button type="button" data-hint={props.automaticFocus ? props.copy.layoutAutoFocus : props.copy.focus} aria-pressed={props.layoutMode === "focus"} className={props.layoutMode === "focus" ? "active" : ""} onClick={() => props.onLayoutChange("focus")}><FocusIcon /><span className="priority-p1">{props.copy.focus}</span></button>
      </div>
      {props.pageControl}
      <PromptComposer copy={props.copy} promptRef={props.promptRef} text={props.text} revision={props.draftRevision}
        expanded={props.expanded} busy={busy} isMac={props.isMac} onTextChange={props.onTextChange}
        onExpandedChange={props.onExpandedChange} onSubmit={props.onSubmit} onPasteImages={props.onPasteImages} />
      <button type="button" className="question-trigger" data-hint={props.copy.questionHistory} aria-label={props.copy.questionHistory} aria-expanded={props.historyOpen ?? false} onClick={props.onOpenHistory}>
        <HistoryIcon />
      </button>
      <TierControls copy={props.copy} tier={props.tier} isMac={props.isMac} onChange={props.onTierChange} />
      {props.imageControl}
      {props.runState !== "idle" ? (
        <button type="button" className="cancel primary-action priority-p0" data-hint={cancelLabel} aria-label={cancelLabel} disabled={props.runState === "cancelling"} onClick={props.onCancel}><StopIcon /><span>{cancelLabel}</span></button>
      ) : (
        <button type="button" className="send primary-action priority-p0" data-hint={props.sendBlockedReason ?? sendLabel} aria-label={sendLabel} disabled={props.auxiliaryBusy || !props.text.trim() || props.selectedCount === 0 || !!props.sendBlockedReason} onClick={props.onSubmit}><SendIcon /><span>{props.copy.send}</span><span className="send-count" aria-hidden="true">{props.selectedCount}</span><kbd>{props.isMac ? "⌘↵" : "Ctrl+↵"}</kbd></button>
      )}
      <WorkspaceActions onCompare={props.onCompare} onRetry={props.onRetry} uncertainCount={props.uncertainCount} onReviewUncertain={props.onReviewUncertain} isMac={props.isMac} copy={props.copy} disabled={busy} failureCount={props.failureCount} cancelledCount={props.cancelledCount} synthesisPending={props.synthesisPending} syncStatus={props.syncStatus} onOpenMore={props.onOpenMore} onOpenArchive={props.onOpenArchive} />
    </header>
  );
}
