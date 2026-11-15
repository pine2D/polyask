import type { ReactNode, RefObject } from "react";
import type { LayoutMode, SiteDefinition, SiteKey } from "../shared/contracts";
import { formatCopy, type DesktopCopy } from "../shared/copy";
import type { PromptTemplate } from "../shared/prompt-library";
import type {
  DesktopSurface,
  LayoutState,
  SiteHistoryState,
  SiteStatus
} from "../shared/protocol";
import type { QuestionRunProgress } from "../shared/question-run-progress";
import type { SiteHealth } from "../shared/site-health";
import type { SyncStatus } from "../shared/sync";
import type { WorkspaceState } from "../shared/workspace";
import { CommandBar } from "./command-bar";
import { executeCommand, type CommandActions } from "./command-dispatcher";
import { focusPromptForEditing } from "./composer-activation";
import { ConfirmDialog } from "./confirm-dialog";
import { requestDecisionNavigation } from "./decision-navigation";
import { ImagePicker } from "./image-picker";
import { PageTabs } from "./page-tabs";
import { PromptDraftRecovery } from "./prompt-draft-recovery";
import { QuestionHistory } from "./question-history";
import type { QuestionReadingRequest } from "./question-reading-request";
import type { PendingSessionConfirmation } from "./session-confirmation";
import { shell } from "./shell-api";
import { SiteFind } from "./site-find";
import { SiteFrames } from "./site-frames";
import type { siteHealthActions } from "./site-health-actions";
import { reloadSiteWithFeedback } from "./site-reload";
import { TaskSetup } from "./task-setup";
import type { useBroadcastFlow } from "./use-broadcast-flow";
import type { useBroadcastRetryReview } from "./use-broadcast-retry-review";
import type { useDraftConfirmation } from "./use-draft-confirmation";
import type { useImageSelection } from "./use-image-selection";
import type { usePromptDraft } from "./use-prompt-draft";
import type { useQuestionRunProgress } from "./use-question-run-progress";
import type { useSitePageClose } from "./use-site-page-close";
import type { useSyncedSiteParticipation } from "./use-synced-site-participation";
import type { useSynthesisFlow } from "./use-synthesis-flow";
import type { useTaskSetup } from "./use-task-setup";
import type { useWorkspaceFlow } from "./use-workspace-flow";
import type { useWorkspaceMotion } from "./use-workspace-motion";
import { WorkspaceDrawer } from "./workspace-drawer";
import {
  type OpenWorkspacePanelState,
  type WorkspacePanelState,
  type WorkspacePanelTab
} from "./workspace-panel-state";
import { WorkspaceProgress } from "./workspace-progress";

export interface WorkbenchMainStageProps {
  readonly copy: DesktopCopy;
  readonly isMac: boolean;
  readonly sites: readonly SiteDefinition[];
  readonly statuses: Record<string, SiteStatus>;
  readonly layout: LayoutState;
  readonly workspace: WorkspaceState;
  readonly workspaceFlow: ReturnType<typeof useWorkspaceFlow>;
  readonly selected: ReadonlySet<SiteKey>;
  readonly participating: ReadonlySet<SiteKey>;
  readonly participation: ReturnType<typeof useSyncedSiteParticipation>;
  readonly runState: ReturnType<typeof useBroadcastFlow>["runState"];
  readonly broadcast: ReturnType<typeof useBroadcastFlow>;
  readonly synthesis: ReturnType<typeof useSynthesisFlow>;
  readonly auxiliaryBusy: boolean;
  readonly navigationBlocked: boolean;
  readonly draftConfirmation: ReturnType<typeof useDraftConfirmation>;
  readonly promptRef: RefObject<HTMLTextAreaElement | null>;
  readonly text: string;
  readonly setText: (value: string) => void;
  readonly draftRevision: ReturnType<typeof usePromptDraft>["revision"];
  readonly promptRecovery: ReturnType<typeof usePromptDraft>["recovery"];
  readonly composer: ReturnType<typeof useWorkspaceMotion>["composer"];
  readonly drawerPresent: boolean;
  readonly drawerOpen: boolean;
  readonly panelState: WorkspacePanelState;
  readonly lastOpenPanel: { current: OpenWorkspacePanelState };
  readonly scopeLabel: string;
  readonly health: Partial<Record<string, SiteHealth>>;
  readonly healthChecking: boolean;
  readonly healthAttention: number;
  readonly healthFeedback: string;
  readonly drawerHealthActions: ReturnType<typeof siteHealthActions>;
  readonly imageSelection: ReturnType<typeof useImageSelection>;
  readonly imageWarning: string | null;
  readonly unsupportedSitesCount: number;
  readonly pageInputMethod: "keyboard" | "pointer";
  readonly setPageInputMethod: (method: "keyboard" | "pointer") => void;
  readonly requestedPage: { current: { readonly page: number; readonly inputMethod: "keyboard" | "pointer" } | null };
  readonly runProgress: ReturnType<typeof useQuestionRunProgress>;
  readonly syncStatus: SyncStatus;
  readonly commandActions: { current: CommandActions };
  readonly surface: DesktopSurface;
  readonly siteHistory: Record<string, SiteHistoryState>;
  readonly questionHistoryOpen: boolean;
  readonly setQuestionHistoryOpen: (open: boolean) => void;
  readonly setQuestionHistoryBlocking: (blocking: boolean) => void;
  readonly questionReadRequest: QuestionReadingRequest | null;
  readonly setQuestionReadRequest: (
    updater: QuestionReadingRequest | null | ((old: QuestionReadingRequest | null) => QuestionReadingRequest | null)
  ) => void;
  readonly closeQuestionHistory: () => void;
  readonly templates: readonly PromptTemplate[];
  readonly taskSetup: ReturnType<typeof useTaskSetup>;
  readonly retryReview: ReturnType<typeof useBroadcastRetryReview>;
  readonly pageClose: ReturnType<typeof useSitePageClose>;
  readonly pendingNewSession: PendingSessionConfirmation | null;
  readonly onConfirmNewSessionDontAsk: () => void;
  readonly changeSurface: (value: DesktopSurface) => void;
  readonly changePanelState: (value: WorkspacePanelState) => void;
  readonly openPanel: (tab: WorkspacePanelTab, inputMethod: "pointer" | "keyboard") => void;
  readonly changeDrawerOpen: (value: boolean) => void;
  readonly refreshSiteHealth: (keys: readonly SiteKey[]) => Promise<void>;
  readonly setAnnouncement: (text: string) => void;
  readonly setMode: (mode: LayoutMode, focused?: SiteKey) => void;
  readonly changeTier: (tier: WorkspaceState["tier"]) => void;
  readonly submit: () => Promise<void>;
  readonly collectAndCompare: () => Promise<void>;
  readonly showGroupMenu: () => Promise<void>;
  readonly showMoreMenu: () => Promise<void>;
  readonly onOpenArchiveFromHistory: (recordId: string, mode: "read" | "compare") => void;
}

export function WorkbenchMainStage(props: WorkbenchMainStageProps): React.JSX.Element {
  const {
    copy, isMac, sites, statuses, layout, workspace, workspaceFlow, selected, participating,
    participation, runState, broadcast, synthesis, auxiliaryBusy, navigationBlocked,
    draftConfirmation, promptRef, text, setText, draftRevision, promptRecovery, composer,
    drawerPresent, drawerOpen, panelState, lastOpenPanel, scopeLabel, health, healthChecking,
    healthAttention, healthFeedback, drawerHealthActions, imageSelection, imageWarning,
    unsupportedSitesCount, pageInputMethod, setPageInputMethod, requestedPage, runProgress,
    syncStatus, commandActions, surface, siteHistory, questionHistoryOpen, setQuestionHistoryOpen,
    setQuestionHistoryBlocking, questionReadRequest, setQuestionReadRequest, closeQuestionHistory,
    templates, taskSetup, retryReview, pageClose, pendingNewSession, onConfirmNewSessionDontAsk,
    changeSurface, changePanelState, openPanel, changeDrawerOpen, refreshSiteHealth,
    setAnnouncement, setMode, changeTier, submit, collectAndCompare, showGroupMenu, showMoreMenu,
    onOpenArchiveFromHistory
  } = props;
  const { images, open: imageTrayOpen } = imageSelection;
  const progressValue: QuestionRunProgress | null = runProgress.value;
  const pageControl: ReactNode = layout.pageCount > 1 ? (
    <PageTabs
      copy={copy}
      isMac={isMac}
      sites={sites}
      selectedSites={workspace.selectedSites}
      statuses={statuses}
      page={layout.page}
      inputMethod={pageInputMethod}
      summaryRunId={broadcast.runId ?? runProgress.runId}
      onPageChange={(page, inputMethod) => {
        requestedPage.current = { page, inputMethod };
        setPageInputMethod(inputMethod);
        setAnnouncement(formatCopy(copy.sitePageChanged, { page: page + 1, total: layout.pageCount }));
        shell.setPage(page);
      }}
    />
  ) : null;

  return (
    <main className={`app-shell${composer.reservedExpanded ? " is-composer-expanded" : ""}${drawerOpen ? " has-drawer" : ""}`}>
      <CommandBar
        copy={copy}
        promptRef={promptRef}
        text={text}
        tier={workspace.tier}
        runState={synthesis.runState !== "idle" ? synthesis.runState : runState}
        auxiliaryBusy={auxiliaryBusy || participation.pending || draftConfirmation.blocking}
        layoutMode={layout.mode}
        automaticFocus={layout.automaticFocus}
        selectedCount={participating.size}
        onNewSession={() => executeCommand("new-session", commandActions.current)}
        newSessionBlockedReason={navigationBlocked ? copy.newSessionBlocked : null}
        failureCount={broadcast.failureCount}
        cancelledCount={broadcast.cancelledCount}
        uncertainCount={broadcast.uncertainSites.length}
        onReviewUncertain={retryReview.reviewUncertain}
        scopeLabel={scopeLabel}
        healthAttention={healthAttention}
        panelTab={panelState?.tab ?? null}
        imageControl={(
          <ImagePicker
            copy={copy}
            images={images}
            selectionIntent={imageSelection.intent}
            onPickerOpen={imageSelection.beginPick}
            open={imageTrayOpen}
            present={imageSelection.present}
            disabled={runState !== "idle" || auxiliaryBusy}
            warning={imageWarning}
            warningCount={unsupportedSitesCount}
            error={imageSelection.error}
            onOpenChange={(open) => {
              if (open) {
                void shell.closeSiteFind(false).catch(() => {});
                changeSurface("sites");
                changePanelState(null);
                setQuestionHistoryOpen(false);
              }
              imageSelection.setOpen(open);
            }}
            onFiles={(files) => { void imageSelection.choose(files); }}
            onRemove={imageSelection.remove}
            onAdjustScope={() => { imageSelection.setOpen(false); changeDrawerOpen(true); }}
          />
        )}
        pageControl={pageControl}
        sendBlockedReason={imageWarning}
        synthesisPending={!!synthesis.pending}
        syncStatus={syncStatus}
        isMac={isMac}
        expanded={composer.expanded}
        reservedExpanded={composer.reservedExpanded}
        revealedExpanded={composer.revealedExpanded}
        draftRevision={draftRevision.current}
        onTextChange={setText}
        draftRecovery={(
          <PromptDraftRecovery
            recovery={promptRecovery}
            copy={copy}
            busy={runState !== "idle" || auxiliaryBusy}
            onClearImages={imageSelection.clear}
            onBlockingChange={(blocking, owner) => draftConfirmation.change(blocking, owner, changeSurface)}
          />
        )}
        onCompare={workspace.selectedSites.filter((site) => statuses[site]?.phase === "complete").length >= 2 ? () => { void collectAndCompare(); } : undefined}
        onSubmit={() => void submit()}
        onCancel={synthesis.runState !== "idle" ? synthesis.cancel : broadcast.cancel}
        onTierChange={changeTier}
        onLayoutChange={setMode}
        onExpandedChange={composer.setExpanded}
        onPanelChange={(tab) => tab ? openPanel(tab, "pointer") : changePanelState(null)}
        onShowGroupMenu={() => { void showGroupMenu(); }}
        onOpenMore={() => { void showMoreMenu(); }}
        historyOpen={questionHistoryOpen}
        onOpenHistory={() => questionHistoryOpen ? closeQuestionHistory() : executeCommand("open-question-history", commandActions.current)}
        onOpenArchive={() => executeCommand("open-archive", commandActions.current)}
        onRetry={() => executeCommand("retry-failed", commandActions.current)}
        onPasteImages={(files) => { void imageSelection.choose(files, "append"); }}
      />
      <WorkspaceProgress
        copy={copy}
        statuses={statuses}
        runId={broadcast.runId ?? runProgress.runId}
        activeSites={broadcast.runId ? broadcast.activeSites : progressValue?.answers.map((answer) => answer.site) ?? []}
        progress={progressValue}
        onRead={() => {
          if (!progressValue?.questionId || !commandActions.current["open-question-history"]) return;
          executeCommand("open-question-history", commandActions.current);
          setQuestionReadRequest((old) => ({
            request: (old?.request ?? 0) + 1,
            questionId: progressValue.questionId!,
            answerId: progressValue.answers.find((answer) => answer.hasText)?.id
          }));
        }}
      />
      {drawerPresent ? (
        <WorkspaceDrawer
          copy={copy}
          sites={sites}
          selected={selected}
          participating={participating}
          participationBusy={runState !== "idle" || auxiliaryBusy || participation.pending}
          groups={workspace.groups}
          statuses={statuses}
          health={health}
          healthChecking={healthChecking}
          open={drawerOpen}
          state={panelState ?? lastOpenPanel.current}
          onStateChange={changePanelState}
          onSelectionChange={(value) => { void participation.reorderOpened(value); }}
          onParticipationChange={(value) => { void participation.change(value); }}
          onCloseSitePage={(site) => { void pageClose.request(site); }}
          onSaveGroup={(name) => workspaceFlow.saveGroup(name, participation.currentSites())}
          onDeleteGroup={workspaceFlow.deleteGroup}
          onCheckHealth={(keys) => { void refreshSiteHealth(keys); }}
          onFocusSite={(site) => {
            changePanelState(null);
            setMode("focus", site);
          }}
          {...drawerHealthActions}
          healthFeedback={healthFeedback}
        />
      ) : null}
      <SiteFrames
        copy={copy}
        sites={sites}
        statuses={statuses}
        layout={layout}
        selected={selected}
        participating={participating}
        participationBusy={runState !== "idle" || auxiliaryBusy || participation.pending}
        onToggle={(site) => { void participation.toggle(site); }}
        onFocus={(site) => setMode("focus", site)}
        onReload={(site) => { void reloadSiteWithFeedback(site, copy, sites, setAnnouncement); }}
        retrySites={broadcast.retrySites}
        uncertainSites={broadcast.uncertainSites}
        retryDisabled={runState !== "idle" || auxiliaryBusy}
        onRetry={retryReview.request}
        history={siteHistory}
        onBack={(site) => shell.stepHistory(-1, site)}
      />
      <SiteFind copy={copy} sites={sites} layout={layout} />
      <QuestionHistory
        imageSyncEnabled={syncStatus.imageSyncEnabled ?? false}
        active={surface === "sites"}
        openRequest={questionReadRequest}
        onBlockingChange={setQuestionHistoryBlocking}
        open={questionHistoryOpen}
        copy={copy}
        sites={sites}
        draft={text}
        draftIntent={() => `${draftRevision.current}:${imageSelection.intent()}`}
        draftImageCount={imageSelection.images.length}
        busy={runState !== "idle" || auxiliaryBusy}
        onArchiveCreated={(record, mode) => {
          if (runState === "idle" && !auxiliaryBusy) {
            requestDecisionNavigation(() => onOpenArchiveFromHistory(record.id, mode));
          }
        }}
        onOpen={() => executeCommand("open-question-history", commandActions.current)}
        onClose={closeQuestionHistory}
        onDraft={(value, nextImages) => {
          imageSelection.replace(nextImages);
          setText(value);
          focusPromptForEditing(promptRef, composer.setExpanded);
        }}
      />
      {taskSetup.session ? (
        <TaskSetup setup={taskSetup} copy={copy} sites={sites} templates={templates} groups={workspace.groups} />
      ) : null}
      {retryReview.review}
      {pageClose.dialog}
      {pendingNewSession && (
        <ConfirmDialog
          copy={copy}
          title={copy.newSessionConfirmTitle}
          message={formatCopy(copy.newSessionConfirmMessage, { count: pendingNewSession.count })}
          confirmLabel={copy.newSessionConfirmAction}
          cancelLabel={copy.newSessionKeepCurrent}
          dontAskLabel={copy.confirmDontAsk}
          onConfirm={(dontAsk) => {
            if (dontAsk) onConfirmNewSessionDontAsk();
            pendingNewSession.decide(true);
          }}
          onCancel={() => pendingNewSession.decide(false)}
        />
      )}
    </main>
  );
}
