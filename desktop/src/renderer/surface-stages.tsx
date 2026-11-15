import type { SiteDefinition, SiteKey } from "../shared/contracts";
import type { DesktopCopy } from "../shared/copy";
import type { DesktopSurface } from "../shared/protocol";
import type { RuntimeInfo } from "../shared/runtime";
import type { SyncStatus } from "../shared/sync";
import type { WorkspaceState } from "../shared/workspace";
import { CommandPaletteSurface, type CommandPaletteSurfaceProps, openLatestReleasePage } from "./app-commands";
import { ArchiveSurface } from "./archive-surface";
import { type BootstrapPhase } from "./bootstrap-model";
import { BootstrapStateView } from "./bootstrap-state";
import { executeCommand, type CommandActions } from "./command-dispatcher";
import { resetLocalSession } from "./local-data-reset";
import type { SettingsTarget } from "./settings-categories";
import { SettingsWorkspace } from "./settings-workspace";
import type { useArchiveSynthesisFlow } from "./use-archive-synthesis-flow";
import type { useBroadcastFlow } from "./use-broadcast-flow";
import type { useDisplayPreferences } from "./use-display-preferences";
import type { useImageSelection } from "./use-image-selection";
import type { useQuestionRunProgress } from "./use-question-run-progress";
import type { useSitePageClose } from "./use-site-page-close";
import type { useSyncedPreferences } from "./use-synced-preferences";
import type { useSyncedSiteParticipation } from "./use-synced-site-participation";
import type { useWorkspaceFlow } from "./use-workspace-flow";
import { WorkbenchMainStage, type WorkbenchMainStageProps } from "./workbench-stage";

export interface ArchiveStageProps {
  readonly copy: DesktopCopy;
  readonly locale: string;
  readonly sites: readonly SiteDefinition[];
  readonly selected: ReadonlySet<SiteKey>;
  readonly defaultTier: WorkspaceState["tier"];
  readonly archiveFlow: ReturnType<typeof useArchiveSynthesisFlow>;
  readonly onClose: () => void;
}

export function ArchiveStage(props: ArchiveStageProps): React.JSX.Element {
  const { copy, locale, sites, selected, defaultTier, archiveFlow, onClose } = props;
  const {
    archiveNavigation, synthesis, synthesisRecovery,
    comparisonDrafts, librarySession, blockLibrary, archiveCapture
  } = archiveFlow;
  return (
    <div className="surface-stage">
      <ArchiveSurface
        copy={copy}
        locale={locale}
        sites={sites}
        synthesisSites={sites.filter((site) => selected.has(site.key))}
        defaultTier={defaultTier}
        comparisonId={archiveNavigation.comparisonId}
        preferredId={synthesisRecovery.editorRequest?.archiveId ?? archiveNavigation.preferredId ?? synthesis.pending?.archiveId ?? null}
        synthesisDrafts={synthesis.drafts}
        synthesisEditorRequest={synthesisRecovery.editorRequest}
        onSynthesisEditorOpened={synthesisRecovery.consumeEditorRequest}
        pendingSynthesis={synthesis.pending}
        synthesisCandidate={synthesis.candidate}
        synthesisSession={synthesis.session}
        comparisonDrafts={comparisonDrafts}
        session={librarySession}
        navigationRevision={archiveNavigation.revision}
        onBlockingChange={blockLibrary}
        onClose={onClose}
        onCapture={archiveCapture.capture}
        onSendSynthesis={synthesisRecovery.send}
        onCollectSynthesis={async () => { await synthesis.collect(); }}
        onSaveSynthesis={synthesis.save}
      />
    </div>
  );
}

export interface SettingsStageProps {
  readonly copy: DesktopCopy;
  readonly locale: string;
  readonly runtime: RuntimeInfo;
  readonly syncStatus: SyncStatus;
  readonly onSyncStatus: (status: SyncStatus) => void;
  readonly onBlockingChange: (blocking: boolean) => void;
  readonly runState: ReturnType<typeof useBroadcastFlow>["runState"];
  readonly auxiliaryBusy: boolean;
  readonly participation: ReturnType<typeof useSyncedSiteParticipation>;
  readonly settingsSection: { readonly section: SettingsTarget; readonly request: number };
  readonly display: ReturnType<typeof useDisplayPreferences>;
  readonly preferences: ReturnType<typeof useSyncedPreferences>;
  readonly commandActions: { current: CommandActions };
  readonly onAnnounce: (text: string) => void;
  readonly workspaceFlow: ReturnType<typeof useWorkspaceFlow>;
  readonly pageClose: ReturnType<typeof useSitePageClose>;
  readonly runProgress: ReturnType<typeof useQuestionRunProgress>;
  readonly archiveFlow: ReturnType<typeof useArchiveSynthesisFlow>;
  readonly broadcast: ReturnType<typeof useBroadcastFlow>;
  readonly imageSelection: ReturnType<typeof useImageSelection>;
  readonly setText: (value: string) => void;
  readonly resetComposer: () => void;
  readonly clearQuestionState: () => void;
  readonly onReloadBootstrap: () => void;
  readonly onClose: () => void;
}

export function SettingsStage(props: SettingsStageProps): React.JSX.Element {
  const {
    copy, locale, runtime, syncStatus, onSyncStatus, onBlockingChange,
    runState, auxiliaryBusy, participation, settingsSection, display,
    preferences, commandActions, onAnnounce, workspaceFlow, pageClose,
    runProgress, archiveFlow, broadcast, imageSelection, setText,
    resetComposer, clearQuestionState, onReloadBootstrap, onClose
  } = props;
  return (
    <div className="surface-stage">
      <SettingsWorkspace copy={copy} locale={locale} runtime={runtime} status={syncStatus} onBlockingChange={onBlockingChange} operationBusy={runState !== "idle" || auxiliaryBusy || participation.pending}
        initialSection={settingsSection.section} sectionRequest={settingsSection.request}
        display={display.value} onDisplayChange={display.save}
        preferenceSync={preferences.settings}
        completionNotifications={preferences.completionNotifications}
        onCompletionNotificationsChange={preferences.onCompletionNotifications}
        confirmations={preferences.confirmations}
        onConfirmationChange={(key, enabled) => { void preferences.onConfirmation(key, enabled); }}
        onCheckUpdates={openLatestReleasePage}
        onOpenShortcuts={() => executeCommand("open-shortcuts", commandActions.current)}
        onOpenGuide={() => executeCommand("open-getting-started", commandActions.current)}
        onStatus={onSyncStatus}
        onAnnounce={onAnnounce}
        onLocalReset={() => {
          void preferences.refresh();
          workspaceFlow.invalidate();
          pageClose.invalidate();
          runProgress.invalidate();
          clearQuestionState();
          archiveFlow.resetStores();
          participation.reset();
          resetComposer();
          resetLocalSession(window.localStorage, {
            setText,
            imageSelection,
            broadcast,
            archiveCapture: archiveFlow.archiveCapture,
            synthesis: archiveFlow.synthesis
          });
          onReloadBootstrap();
        }}
        onClose={onClose}
      />
    </div>
  );
}

export interface AppSurfaceRouterProps {
  readonly bootstrapPhase: BootstrapPhase;
  readonly announcement: string;
  readonly onRetryBootstrap: () => void;
  readonly surface: DesktopSurface;
  readonly archive: ArchiveStageProps;
  readonly settings: SettingsStageProps;
  readonly commands: CommandPaletteSurfaceProps;
  readonly workbench: WorkbenchMainStageProps;
}

export function AppSurfaceRouter(props: AppSurfaceRouterProps): React.JSX.Element {
  if (props.bootstrapPhase !== "ready") {
    return (
      <BootstrapStateView
        copy={props.workbench.copy}
        phase={props.bootstrapPhase}
        announcement={props.announcement}
        onRetry={props.onRetryBootstrap}
      />
    );
  }
  if (props.surface === "archive") {
    return <ArchiveStage {...props.archive} />;
  }
  if (props.surface === "settings") {
    return <SettingsStage {...props.settings} />;
  }
  if (props.surface === "commands") {
    return <CommandPaletteSurface {...props.commands} />;
  }
  return <WorkbenchMainStage {...props.workbench} />;
}
