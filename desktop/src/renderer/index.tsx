import { StrictMode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import type { LayoutMode, SiteDefinition } from "../shared/contracts";
import { formatCopy, getCopy, resolveLocale } from "../shared/copy";
import type { PromptLibraryState } from "../shared/prompt-library";
import {
  siteStatusRunId,
  type BootstrapState,
  type DesktopSurface,
  type LayoutState,
  type MenuShortcut,
  type SiteNavigationHistoryState,
  type SiteStatus
} from "../shared/protocol";
import type { QuestionRunProgress } from "../shared/question-run-progress";
import type { RuntimeInfo } from "../shared/runtime";
import { describeStatus } from "../shared/status-copy";
import type { SyncStatus } from "../shared/sync";
import { buildAppCommands } from "./app-commands";
import { INITIAL_LAYOUT, loadBootstrap, type BootstrapPhase } from "./bootstrap-model";
import { broadcastFeedback } from "./broadcast-feedback";
import { ExclusiveActionLock } from "./broadcast-flow-state";
import { executeCommand, type CommandActions } from "./command-dispatcher";
import type { CommandPaletteMode } from "./command-palette";
import { focusPromptForEditing } from "./composer-activation";
import { applyDisplayDensity, loadDisplayPreferences } from "./display-preferences";
import { FeedbackProvider, usePreviewBadge } from "./feedback-provider";
import { imageSupportWarning } from "./image-support-warning";
import { resetLocalSession } from "./local-data-reset";
import { confirmAndStartNewSession } from "./new-session-action";
import { currentPlatform, isMac } from "./platform";
import type { QuestionReadingRequest } from "./question-reading-request";
import type { PendingSessionConfirmation } from "./session-confirmation";
import type { SettingsTarget } from "./settings-categories";
import { shell } from "./shell-api";
import { AppSurfaceRouter } from "./surface-stages";
import { requestSurfaceChange } from "./surface-transition";
import { tierChangeAction } from "./tier-change-action";
import { useArchiveSynthesisFlow } from "./use-archive-synthesis-flow";
import { useBroadcastFlow } from "./use-broadcast-flow";
import { useCommandDiscovery } from "./use-command-discovery";
import { useCommandPaletteShortcut } from "./use-command-palette-shortcut";
import { useDisplayPreferences } from "./use-display-preferences";
import { startThemedShell } from "./ui-theme";
import { useDraftConfirmation } from "./use-draft-confirmation";
import { useDraftReplaceUndo } from "./use-draft-replace-undo";
import { useFeedback } from "./use-feedback";
import { useImageSelection } from "./use-image-selection";
import { useNotificationNavigation } from "./use-notification-navigation";
import { usePanelFocusReturn } from "./use-panel-focus-return";
import { usePromptDraft } from "./use-prompt-draft";
import { useProxyPendingNotice } from "./use-proxy-state";
import { useQuestionRunProgress } from "./use-question-run-progress";
import { useSiteHealthPanel } from "./use-site-health-panel";
import { useSyncedPreferences } from "./use-synced-preferences";
import { useSyncedSiteParticipation } from "./use-synced-site-participation";
import { useTaskSetup } from "./use-task-setup";
import { useTemplateDeletion } from "./use-template-deletion";
import { useWorkbenchConfirmations } from "./use-workbench-confirmations";
import { useWorkspaceFlow } from "./use-workspace-flow";
import { useWorkspaceMotion } from "./use-workspace-motion";
import { workspaceMenuActions } from "./workspace-menu-actions";
import {
  openWorkspacePanel,
  scopeDisplayName,
  type WorkspacePanelState,
  type WorkspacePanelTab
} from "./workspace-panel-state";
import "./styles.css";
import "./settings.css";
import "./accessibility.css";
import "./feedback.css";

const INITIAL_DISPLAY = loadDisplayPreferences(
  window.localStorage,
  window.matchMedia("(pointer: coarse)").matches
);
const INITIAL_SYNC: SyncStatus = {
  state: "idle", connected: false, pending: 0, errorCount: 0,
  readOnly: false, oauthConfigured: false, secureTokenStorage: true
};
const INITIAL_RUNTIME: RuntimeInfo = { version: "", distribution: "installed" };
const INITIAL_LIBRARY: PromptLibraryState = { templates: [], history: [] };

applyDisplayDensity(document.documentElement, INITIAL_DISPLAY);

function App(): React.JSX.Element {
  const copy = useMemo(() => getCopy(navigator.language), []);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const bootstrapStarted = useRef(false);
  const sitesRef = useRef<readonly SiteDefinition[]>([]);
  const layoutPage = useRef(0);
  const automaticFocus = useRef(false);
  const requestedPage = useRef<{ readonly page: number; readonly inputMethod: "keyboard" | "pointer" } | null>(null);
  const newSessionInFlight = useRef(false);
  const actionLock = useRef<ExclusiveActionLock | null>(null);
  const commandActions = useRef<CommandActions>({});
  const draftConfirmation = useDraftConfirmation(commandActions);
  if (!actionLock.current) actionLock.current = new ExclusiveActionLock();
  const [bootstrapPhase, setBootstrapPhase] = useState<BootstrapPhase>("loading");
  const [sites, setSites] = useState<readonly SiteDefinition[]>([]);
  const paletteShortcut = useCommandPaletteShortcut();
  const [menuShortcuts, setMenuShortcuts] = useState<readonly MenuShortcut[]>([]);
  const [siteNavigationHistory, setSiteNavigationHistory] = useState<Record<string, SiteNavigationHistoryState>>({});
  // Alt+N 的确认改用应用内弹层（原生 dialog.showMessageBox 与本应用外观格格不入）。
  // 存 resolve 而不是布尔：调用方仍是 `await` 的形态，业务逻辑不必改写成回调。
  const [pendingNewSession, setPendingNewSession] = useState<PendingSessionConfirmation | null>(null);
  const [statuses, setStatuses] = useState<Record<string, SiteStatus>>({});
  const [layout, setLayout] = useState<LayoutState>(INITIAL_LAYOUT);
  const { text, setText, revision: draftRevision, clearSent, recovery: promptRecovery, flushDraft } = usePromptDraft(copy);
  const [auxiliaryWorkBusy, setAuxiliaryBusy] = useState(false);
  const [surface, setSurface] = useState<DesktopSurface>("sites");
  const [questionHistoryOpen, setQuestionHistoryOpen] = useState(false);
  const [questionReadRequest, setQuestionReadRequest] = useState<QuestionReadingRequest | null>(null);
  const [bootstrapProgress, setBootstrapProgress] = useState<QuestionRunProgress | null>(null);
  const [questionHistoryBlocking, setQuestionHistoryBlocking] = useState(false);
  const closeQuestionHistory = (): void => { setQuestionReadRequest(null); setQuestionHistoryOpen(false); };
  const [settingsBlocking, setSettingsBlocking] = useState(false);
  const blockSettings = useCallback((value: boolean) => { if (value) commandActions.current = {}; setSettingsBlocking(value); }, []);
  const [settingsSection, setSettingsSection] = useState<{ section: SettingsTarget; request: number }>({ section: "appearance", request: 0 });
  const [commandMode, setCommandMode] = useState<CommandPaletteMode>("commands");
  const [syncStatus, setSyncStatus] = useState<SyncStatus>(INITIAL_SYNC);
  const [runtime, setRuntime] = useState<RuntimeInfo>(INITIAL_RUNTIME);
  usePreviewBadge(Boolean(runtime.preview));
  const [promptLibrary, setPromptLibrary] = useState<PromptLibraryState>(INITIAL_LIBRARY);
  const templateDeletion = useTemplateDeletion(promptLibrary, setPromptLibrary, copy);
  const { announcement, announce: setAnnouncement, clearNotice, healthFeedback, noteHealth } = useFeedback();
  const [pageInputMethod, setPageInputMethod] = useState<"keyboard" | "pointer">("pointer");
  const workspaceFlow = useWorkspaceFlow(sites, copy.workspaceActionFailed, setAnnouncement);
  const { workspace, openedSites } = workspaceFlow;
  const {
    health, setHealth, healthChecking, refreshSiteHealth, healthAttention,
    panelState, lastOpenPanel, drawerOpen, updatePanelState, drawerHealthActions
  } = useSiteHealthPanel({ copy, sites, selected: openedSites, runtime, statuses, noteHealth, onAnnounce: setAnnouncement });
  const changePanelState = (value: WorkspacePanelState): void => {
    updatePanelState(value, () => { setQuestionHistoryOpen(false); imageSelection.setOpen(false); });
  };
  const openPanel = (tab: WorkspacePanelTab, inputMethod: "pointer" | "keyboard"): void => {
    changeSurface("sites");
    changePanelState(openWorkspacePanel(tab, inputMethod));
    if (tab === "health") void refreshSiteHealth(workspace.selectedSites);
  };
  const changeDrawerOpen = (value: boolean): void => {
    changePanelState(value ? openWorkspacePanel("sites", "pointer") : null);
  };
  const participation = useSyncedSiteParticipation(workspaceFlow, bootstrapPhase === "ready",
    actionLock.current!, () => setAnnouncement(copy.workspaceActionFailed));
  const participatingSites = useMemo(() => new Set(participation.participating), [participation.participating]);
  const archiveFlow = useArchiveSynthesisFlow({
    copy, sites, participatingSites, prompt: text, actionLock: actionLock.current!, commandActions,
    onPrepareSynthesisTarget: () => { runProgress.invalidate(); broadcast.invalidate(); changeSurface("sites"); },
    onChangeSurface: (next) => changeSurface(next)
  });
  const { synthesis, archiveCapture, archiveNavigation, libraryBlocking } = archiveFlow;
  const auxiliaryBusy = auxiliaryWorkBusy || synthesis.runState !== "idle";
  const broadcast = useBroadcastFlow(
    () => setAnnouncement(copy.failed),
    archiveCapture.remember,
    archiveCapture.invalidate,
    (run) => setAnnouncement(broadcastFeedback(copy, run))
  );
  const { runState } = broadcast;
  const runProgress = useQuestionRunProgress(broadcast.runId, bootstrapProgress);
  const display = useDisplayPreferences(INITIAL_DISPLAY, () => setAnnouncement(copy.displayPreferencesFailed));
  const preferences = useSyncedPreferences({ display: display.value, onDisplay: display.accept, onPersistenceFailure: () => setAnnouncement(copy.preferencesSaveFailed) });
  const { pageClose, retryReview } = useWorkbenchConfirmations({
    copy, sites, broadcast, workspaceFlow, actionLock: actionLock.current!, commandActions,
    runState, auxiliaryBusy, participationPending: participation.pending, draftBlocking: draftConfirmation.blocking,
    sitePageCloseConfirm: preferences.confirmations.sitePageCloseConfirm,
    onSitePageCloseConfirmChange: (enabled) => { void preferences.onConfirmation("sitePageCloseConfirm", enabled); },
    drawerOpen, changeDrawerOpen, openPanel, changeSurface: (next) => changeSurface(next), onAnnounce: setAnnouncement
  });
  const imageSelection = useImageSelection(copy, runState === "idle" && !auxiliaryBusy, setAnnouncement);
  usePanelFocusReturn(surface !== "sites" || drawerOpen || questionHistoryOpen || (imageSelection.open && imageSelection.images.length > 0));
  const acceptBootstrap = (state: BootstrapState): void => {
    setRuntime(state.runtime);
    setSites(state.sites);
    sitesRef.current = state.sites;
    setStatuses(Object.fromEntries(state.statuses.map((status) => [status.site, status])));
    layoutPage.current = state.layout.page;
    setLayout(state.layout);
    workspaceFlow.accept(state.workspace);
    setPromptLibrary(state.promptLibrary);
    synthesis.acceptPending(state.pendingSynthesis);
    setBootstrapProgress(state.questionRunProgress ?? null);
    setSyncStatus(state.sync);
  };
  const bootstrap = async (): Promise<void> => {
    setBootstrapPhase("loading");
    setBootstrapPhase(await loadBootstrap(shell.bootstrap, acceptBootstrap));
  };

  useEffect(() => {
    if (!bootstrapStarted.current) {
      bootstrapStarted.current = true;
      void bootstrap();
    }
    const offStatus = shell.onStatus((status) => {
      setStatuses((current) => ({ ...current, [status.site]: status }));
      broadcast.acceptStatus(status);
      // 站点自己发起的主帧导航（点登录跳 auth、被 302 到外部页）会把阶段打回 loading。
      // 此时旧的健康结论已不成立，必须失效——否则面板会长期展示一个过期的「可提问」。
      // 失效信号已经在这条 status 里，不需要新 IPC 通道。
      if (status.phase === "loading") {
        setHealth((current) => {
          if (!current[status.site]) return current;
          const next = { ...current };
          delete next[status.site];
          return next;
        });
      }
      const label = sitesRef.current.find((site) => site.key === status.site)?.label ?? status.site;
      setAnnouncement(`${label}: ${describeStatus(copy, status)}`, false);
    });
    const offLayout = shell.onLayout((next) => flushSync(() => {
      if (next.page !== layoutPage.current) {
        const request = requestedPage.current?.page === next.page ? requestedPage.current : null;
        setPageInputMethod(request?.inputMethod ?? "keyboard");
        if (!request) {
          setAnnouncement(formatCopy(copy.sitePageChanged, { page: next.page + 1, total: next.pageCount }));
        }
        requestedPage.current = null;
        layoutPage.current = next.page;
      }
      if (next.automaticFocus && !automaticFocus.current) setAnnouncement(copy.layoutAutoFocus);
      if (!next.automaticFocus) clearNotice(copy.layoutAutoFocus);
      automaticFocus.current = !!next.automaticFocus;
      setLayout(next);
    }));
    const offDisplay = shell.onDisplayPreferences(display.accept);
    const offCommand = shell.onCommand((id) => executeCommand(id, commandActions.current));
    const offWorkspace = shell.onWorkspaceState(workspaceFlow.accept);
    const offPromptLibrary = shell.onPromptLibrary(setPromptLibrary);
    const offSync = shell.onSyncStatus(setSyncStatus);
    return () => {
      offStatus();
      offLayout();
      offDisplay();
      offCommand();
      offWorkspace();
      offPromptLibrary();
      offSync();
    };
  }, [copy]);

  const { composer, drawerPresent } = useWorkspaceMotion(surface, drawerOpen, lastOpenPanel.current.inputMethod, imageSelection.present, { layout, density: display.value.density, covered: surface === "confirmation" });
  const replaceDraft = useDraftReplaceUndo(copy, text, setText, () => focusPromptForEditing(promptRef, composer.setExpanded));
  const scopeLabel = useMemo(() => scopeDisplayName(participation.participating, workspace.groups, copy), [copy, workspace.groups, participation.participating]);
  const { unsupportedSites, imageWarning } = imageSupportWarning(copy, imageSelection.images.length, participatingSites, sites, navigator.language);

  const submit = async (): Promise<void> => {
    const prompt = text.trim();
    const sentRevision = draftRevision.current;
    if (draftConfirmation.isBlocking() || !prompt || !participation.currentSites().length || runState !== "idle" || participation.pending) return;
    await actionLock.current!.run(async () => {
      if (imageWarning) {
        setAnnouncement(imageWarning);
        imageSelection.setOpen(false);
        changeDrawerOpen(true);
        return;
      }
      const sentImages = imageSelection.prepareSend();
      const savedDraft = flushDraft();
      await broadcast.send({
        text: prompt,
        tier: workspace.tier,
        sites: participation.currentSites(),
        images: sentImages.images
      }, () => {
        sentImages.clearSent();
        if (draftRevision.isCurrent(sentRevision)) composer.reset();
        clearSent(sentRevision, savedDraft);
      });
    });
  };

  const setMode = (mode: LayoutMode, focused = layout.focused): void => {
    if (draftConfirmation.isBlocking()) return;
    shell.setLayout(mode, focused);
  };

  const changeSurface = (value: DesktopSurface): void => requestSurfaceChange(surface, value, {
    surfaceChanged: draftConfirmation.surfaceChanged,
    closeHistory: () => setQuestionHistoryOpen(false), closeImages: imageSelection.invalidateAndClose,
    resetComposer: composer.reset, closeDrawer: () => { if (drawerOpen) changeDrawerOpen(false); },
    commit: (next) => { setSurface(next); shell.setSurface(next); }
  });
  const runAuxiliary = async (action: () => Promise<void>): Promise<void> => {
    if (draftConfirmation.isBlocking() || runState !== "idle") return;
    await actionLock.current!.run(async () => {
      setAuxiliaryBusy(true);
      try { await action(); } finally { setAuxiliaryBusy(false); }
    });
  };
  const changeTier = tierChangeAction({ copy, sites, run: runAuxiliary, change: workspaceFlow.changeTier, announce: setAnnouncement });
  const taskSetup = useTaskSetup({ templates: promptLibrary.templates, groups: workspace.groups, sites, prompt: text, imageCount: imageSelection.images.length,
    getIntent: () => `${draftRevision.current}:${imageSelection.intent()}`, busy: () => runState !== "idle" || auxiliaryBusy,
    lock: actionLock.current!, participation, changeTier: workspaceFlow.changeTier, onApply: setText,
    onApplied: () => { setAnnouncement(copy.taskSetupApplied); focusPromptForEditing(promptRef, composer.setExpanded); },
    onBlockingChange: (blocking, owner) => draftConfirmation.change(blocking, owner, changeSurface) });
  const { collectAndCopy, collectSynthesis, collectAndCompare: captureComparison } = archiveFlow.createCollectionActions(runAuxiliary, setAnnouncement);
  const operationBusy = runState !== "idle" || auxiliaryBusy || participation.pending;
  const completedParticipants = participation.participating.filter(site => statuses[site]?.phase === "complete"
    && (!broadcast.runId || siteStatusRunId(statuses[site]) === broadcast.runId));
  const collectAndCompare = !operationBusy && completedParticipants.length >= 2
    ? () => captureComparison(completedParticipants) : undefined;
  const startNewSession = async (): Promise<void> => {
    if (draftConfirmation.isBlocking() || pendingNewSession || auxiliaryBusy || runState !== "idle") return;
    if (newSessionInFlight.current || participation.pending || actionLock.current!.busy) return;
    newSessionInFlight.current = true;
    try { await confirmAndStartNewSession({ sites: participation.currentSites(), copy, confirm: preferences.confirmations.newSessionConfirm, show: setPendingNewSession, changeSurface,
      run: runAuxiliary, send: shell.newSession, recover: workspaceFlow.recover, announce: setAnnouncement,
      invalidate: () => { broadcast.invalidate(); runProgress.invalidate(); archiveCapture.invalidate(); }
    }); } finally { newSessionInFlight.current = false; }
  };
  const {showGroupMenu, showMoreMenu} = workspaceMenuActions(workspace.groups, participation.change, commandActions, () => setAnnouncement(copy.workspaceActionFailed));

  const onLocalReset = (): void => {
    void preferences.refresh();
    workspaceFlow.invalidate();
    pageClose.invalidate();
    runProgress.invalidate();
    setBootstrapProgress(null);
    setQuestionReadRequest(null);
    archiveFlow.resetStores();
    participation.reset();
    composer.reset();
    resetLocalSession(window.localStorage, { setText, imageSelection, broadcast, archiveCapture, synthesis });
    void bootstrap();
  };

  const openCommandSurface = (mode: CommandPaletteMode): void => { setCommandMode(mode); changeSurface("commands"); };
  const openSettings = (section: SettingsTarget): void => {
    setSettingsSection((value) => ({ section, request: value.request + 1 }));
    changeSurface("settings");
  };
  useProxyPendingNotice(copy, () => openSettings("proxy"));

  const navigationBlocked = !!(draftConfirmation.blocking || pendingNewSession || questionHistoryBlocking || settingsBlocking || libraryBlocking || retryReview.open || pageClose.blocking || participation.pending);
  useNotificationNavigation({ copy, blocked: () => bootstrapPhase !== "ready" || navigationBlocked || runState !== "idle" || auxiliaryBusy,
    canOpenSite: (target) => openedSites.has(target.site) && siteStatusRunId(statuses[target.site]) === target.runId,
    onOpenSite: (site) => { closeQuestionHistory(); changePanelState(null); imageSelection.setOpen(false); changeSurface("sites"); if (drawerOpen) changeDrawerOpen(false); setMode("focus", site); },
    onAnnounce: setAnnouncement, onOpenQuestion: (target) => {
      changeSurface("sites"); changePanelState(null); imageSelection.setOpen(false); changeDrawerOpen(false);
      setQuestionReadRequest((previous) => ({ request: (previous?.request ?? 0) + 1, questionId: target.questionId, answerId: target.answerId }));
      setQuestionHistoryOpen(true);
    } });
  commandActions.current = navigationBlocked ? {} : buildAppCommands({
    copy, layout, openedSites: workspace.selectedSites, participatingSites, statuses, siteNavigationHistory,
    drawerOpen, composer, promptRef, requestedPage, setPageInputMethod, setAnnouncement, changeSurface,
    changeDrawerOpen, changePanelState, openPanel, openCommandSurface, openTaskSetup: taskSetup.open,
    openSettings, setMode, changeTier, closeQuestionHistory,
    openQuestionHistory: () => { changeSurface("sites"); changePanelState(null); imageSelection.setOpen(false); setQuestionReadRequest(null); setQuestionHistoryOpen(true); },
    closeImagePicker: () => imageSelection.setOpen(false),
    collectAndCopy: operationBusy ? undefined : collectAndCopy, collectAndCompare, collectSynthesis, synthesisPending: !!synthesis.pending,
    retrySitesCount: broadcast.retrySites.length, requestRetryReview: () => retryReview.request(),
    clearArchiveNavigation: () => archiveNavigation.clear(), startNewSession
  });
  useCommandDiscovery({ shortcutRevision: paletteShortcut.state?.revision, focused: layout.focused, statuses, surface, setSiteNavigationHistory, setMenuShortcuts });

  return (
    <AppSurfaceRouter
      bootstrapPhase={bootstrapPhase} announcement={announcement} onRetryBootstrap={() => { void bootstrap(); }} surface={surface}
      archive={{ copy, locale: navigator.language, sites, openedSites, defaultTier: workspace.tier, archiveFlow, onClose: () => changeSurface("sites") }}
      settings={{
        copy, locale: navigator.language, runtime, syncStatus, onSyncStatus: setSyncStatus, onBlockingChange: blockSettings,
        operationBusy, settingsSection, display, preferences, commandActions, onAnnounce: setAnnouncement,
        onLocalReset, onClose: () => changeSurface("sites")
      }}
      commands={{
        copy, shortcutMode: paletteShortcut.state?.mode ?? "standard", commandActions, pageCount: layout.pageCount,
        menuShortcuts, groups: workspace.groups, library: templateDeletion.library, draft: text, isMac, mode: commandMode,
        onModeChange: setCommandMode, onApplyGroup: participation.change, onReplaceDraft: replaceDraft,
        onLibrarySaved: setPromptLibrary, onDeleteTemplate: templateDeletion.request, onAnnounce: setAnnouncement, onClose: () => changeSurface("sites")
      }}
      workbench={{
        copy, isMac, sites, statuses, layout, workspace, workspaceFlow, openedSites, participatingSites, participation,
        runState, broadcast, synthesis, auxiliaryBusy, navigationBlocked, draftConfirmation, promptRef,
        text, setText, draftRevision, promptRecovery, composer, drawerPresent, drawerOpen, panelState,
        lastOpenPanel, scopeLabel, health, healthChecking, healthAttention, healthFeedback, drawerHealthActions,
        imageSelection, imageWarning, unsupportedSitesCount: unsupportedSites.length, pageInputMethod, setPageInputMethod,
        requestedPage, runProgress, syncStatus, commandActions, surface, siteNavigationHistory, questionHistoryOpen,
        setQuestionHistoryOpen, setQuestionHistoryBlocking, questionReadRequest, setQuestionReadRequest,
        closeQuestionHistory, templates: promptLibrary.templates, taskSetup, retryReview, pageClose,
        pendingNewSession, onConfirmNewSessionDontAsk: () => { void preferences.onConfirmation("newSessionConfirm", false); },
        changeSurface, changePanelState, openPanel, changeDrawerOpen, refreshSiteHealth, setAnnouncement,
        setMode, changeTier, submit, collectAndCompare, showGroupMenu, showMoreMenu,
        onOpenArchiveFromHistory: (recordId, mode) => archiveFlow.openFromHistory(recordId, mode)
      }}
    />
  );
}

const languageTags = { zhCN: 'zh-CN', zhTW: 'zh-TW', en: 'en' };
document.documentElement.lang = languageTags[resolveLocale(navigator.language)];
document.documentElement.dataset.platform = currentPlatform;
document.title = getCopy(navigator.language).appTitle;
void startThemedShell(() => createRoot(document.getElementById("root")!).render(
  <StrictMode><FeedbackProvider copy={getCopy(navigator.language)}><App /></FeedbackProvider></StrictMode>));
