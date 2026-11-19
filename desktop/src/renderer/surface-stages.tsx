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
import type { SettingsTarget } from "./settings-categories";
import { SettingsWorkspace } from "./settings-workspace";
import type { useArchiveSynthesisFlow } from "./use-archive-synthesis-flow";
import type { useDisplayPreferences } from "./use-display-preferences";
import type { useSyncedPreferences } from "./use-synced-preferences";
import { WorkbenchMainStage, type WorkbenchMainStageProps } from "./workbench-stage";
import { WindowTitleBar } from "./window-titlebar";

export interface ArchiveStageProps {
  readonly copy: DesktopCopy;
  readonly locale: string;
  readonly sites: readonly SiteDefinition[];
  readonly openedSites: ReadonlySet<SiteKey>;
  readonly defaultTier: WorkspaceState["tier"];
  readonly archiveFlow: ReturnType<typeof useArchiveSynthesisFlow>;
  readonly onClose: () => void;
}

export function ArchiveStage(props: ArchiveStageProps): React.JSX.Element {
  const { copy, locale, sites, openedSites, defaultTier, archiveFlow, onClose } = props;
  const {
    archiveNavigation, synthesis, synthesisRecovery,
    comparisonDrafts, librarySession, blockLibrary, archiveCapture
  } = archiveFlow;
  return (
    <ArchiveSurface
      copy={copy}
      locale={locale}
      sites={sites}
      synthesisSites={sites.filter((site) => openedSites.has(site.key))}
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
  );
}

export interface SettingsStageProps {
  readonly copy: DesktopCopy;
  readonly locale: string;
  readonly runtime: RuntimeInfo;
  readonly syncStatus: SyncStatus;
  readonly onSyncStatus: (status: SyncStatus) => void;
  readonly onBlockingChange: (blocking: boolean) => void;
  readonly operationBusy: boolean;
  readonly settingsSection: { readonly section: SettingsTarget; readonly request: number };
  readonly display: ReturnType<typeof useDisplayPreferences>;
  readonly preferences: ReturnType<typeof useSyncedPreferences>;
  readonly commandActions: { current: CommandActions };
  readonly onAnnounce: (text: string) => void;
  readonly onLocalReset: () => void;
  readonly onClose: () => void;
}

export function SettingsStage(props: SettingsStageProps): React.JSX.Element {
  const {
    copy, locale, runtime, syncStatus, onSyncStatus, onBlockingChange,
    operationBusy, settingsSection, display, preferences, commandActions, onAnnounce, onLocalReset, onClose
  } = props;
  return (
    <SettingsWorkspace copy={copy} locale={locale} runtime={runtime} status={syncStatus} onBlockingChange={onBlockingChange} operationBusy={operationBusy}
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
      onLocalReset={onLocalReset}
      onClose={onClose}
    />
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
  const titleBar = (
    <WindowTitleBar
      copy={props.workbench.copy}
      isMac={props.workbench.isMac}
      preview={Boolean(props.settings.runtime.preview)}
    />
  );
  if (props.bootstrapPhase !== "ready") {
    return (
      <>
        {titleBar}
        <BootstrapStateView
          copy={props.workbench.copy}
          phase={props.bootstrapPhase}
          announcement={props.announcement}
          onRetry={props.onRetryBootstrap}
        />
      </>
    );
  }
  if (props.surface === "archive" || props.surface === "settings") {
    return (
      <>
        {titleBar}
        <div className="surface-stage">
          {props.surface === "archive" ? (
            <ArchiveStage {...props.archive} />
          ) : (
            <SettingsStage {...props.settings} />
          )}
        </div>
      </>
    );
  }
  if (props.surface === "commands") {
    return (
      <>
        {titleBar}
        <CommandPaletteSurface {...props.commands} />
      </>
    );
  }
  return (
    <>
      {titleBar}
      <WorkbenchMainStage {...props.workbench} />
    </>
  );
}
