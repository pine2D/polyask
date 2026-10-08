import { QuestionHistory } from "./question-history";
import { StrictMode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";

import { MORE_MENU_IDS } from "../shared/more-menu";
import { COMMANDS, type CommandId } from "../shared/commands";
import type { SiteDefinition } from "../shared/contracts";
import type { CommandActions } from "./command-dispatcher";
import { formatCopy, getCopy, resolveLocale } from "../shared/copy";
import { imageSupportWarning } from './image-support-warning';
import type { QuestionRunProgress } from '../shared/question-run-progress';
import { useQuestionRunProgress } from './use-question-run-progress';
import { useSiteHealthRefresh } from './use-site-health-refresh';
import type { QuestionReadingRequest } from './question-reading-request';
import { createComparisonDraftStore } from './comparison-draft-store';
import { createLibrarySessionStore } from './library-session';
import type {
  BootstrapState,
  DesktopSurface,
  LayoutState,
  MenuShortcut,
  SiteHistoryState,
  SiteStatus
} from "../shared/protocol";
import { describeStatus, errorCode } from "../shared/status-copy";
import type { SyncStatus } from "../shared/sync";
import type { RuntimeInfo } from "../shared/runtime";
import type { SiteHealth } from "../shared/site-health";
import { siteHealthActions } from "./site-health-actions";
import type { PromptLibraryState } from "../shared/prompt-library";
import { ArchiveSurface } from "./archive-surface";
import { loadBootstrap, type BootstrapPhase } from "./bootstrap-model";
import { BootstrapStateView } from "./bootstrap-state";
import { ExclusiveActionLock } from "./broadcast-flow-state";
import { CommandBar } from "./command-bar";
import { ConfirmDialog } from "./confirm-dialog";
import { confirmNewSession, type PendingSessionConfirmation } from "./session-confirmation";
import { CommandPalette, type CommandPaletteMode } from "./command-palette";
import { executeCommand } from "./command-dispatcher";
import {
  loadCompletionNotifications,
  saveCompletionNotifications
} from "./completion-notification-preference";
import {
  applyDisplayDensity,
  loadDisplayPreferences,
} from "./display-preferences";
import { useDisplayPreferences } from "./use-display-preferences";
import { useArchiveNavigation } from "./use-archive-navigation";
import { ImagePicker } from "./image-picker";
import { PageTabs } from './page-tabs';
import { WorkspaceProgress } from './workspace-progress';
import { resetLocalSession } from "./local-data-reset";
import { useTemplateDeletion } from "./use-template-deletion";
import { usePromptDraft } from "./use-prompt-draft";
import { focusPromptForEditing, restoreWorkbenchFocus } from "./composer-activation";
import { useWorkspaceMotion } from "./use-workspace-motion";
import { FeedbackProvider } from "./feedback-provider";
import { broadcastFeedback } from "./broadcast-feedback";
import { archiveCollectionActions } from "./archive-collection-actions";
import { useBroadcastRetryReview } from "./use-broadcast-retry-review";
import { inspectBroadcastSite } from "./broadcast-site-inspection";
import { useFeedback } from "./use-feedback";
import { SiteFrames } from "./site-frames";
import { SettingsWorkspace } from "./settings-workspace";
import { nextSiteForStatus } from "./site-navigation";
import { WorkspaceDrawer } from "./workspace-drawer";
import {
  openWorkspacePanel,
  scopeDisplayName,
  type OpenWorkspacePanelState,
  type WorkspacePanelState,
  type WorkspacePanelTab
} from "./workspace-panel-state";
import { useArchiveCapture } from "./use-archive-capture";
import { useBroadcastFlow } from "./use-broadcast-flow";
import { useImageSelection } from "./use-image-selection";
import { useSynthesisFlow } from "./use-synthesis-flow";
import { useSynthesisRecovery } from "./use-synthesis-recovery";
import { useWorkspaceFlow } from "./use-workspace-flow";
import { useSiteParticipation } from './use-site-participation';
import { useSitePageClose } from './use-site-page-close';
import { shell } from "./shell-api";
import { requestDecisionNavigation } from "./decision-navigation";
import { currentPlatform, isMac } from "./platform";
import "./styles.css";
import "./settings.css";
import "./accessibility.css";
import "./feedback.css";

// TODO(size-ratchet)：723 行，目标 ≤400——抽出命令表装配（buildCommands）、站点健康动作（reload/hard-reload/clear/copy-report）
// 与辅助综合/结果库流三块；App 只留状态编排与渲染分支。
const INITIAL_LAYOUT: LayoutState = {
  mode: "overview",
  focused: "claude",
  page: 0,
  pageCount: 1,
  placements: []
};

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
const LATEST_RELEASE_URL = "https://github.com/pine2D/polyask/releases/latest";

applyDisplayDensity(document.documentElement, INITIAL_DISPLAY);

function App(): React.JSX.Element {
  const copy = useMemo(() => getCopy(navigator.language), []);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const bootstrapStarted = useRef(false);
  const sitesRef = useRef<readonly SiteDefinition[]>([]);
  const layoutPage = useRef(0);
  const automaticFocus = useRef(false);
  const requestedPage = useRef<{ readonly page: number; readonly inputMethod: "keyboard" | "pointer" } | null>(null);
  const actionLock = useRef<ExclusiveActionLock | null>(null);
  const commandActions = useRef<CommandActions>({});
  const lastOpenPanel = useRef<OpenWorkspacePanelState>(openWorkspacePanel("sites", "pointer"));
  if (!actionLock.current) actionLock.current = new ExclusiveActionLock();
  const [bootstrapPhase, setBootstrapPhase] = useState<BootstrapPhase>("loading");
  const [sites, setSites] = useState<readonly SiteDefinition[]>([]);
  const [menuShortcuts, setMenuShortcuts] = useState<readonly MenuShortcut[]>([]);
  const [siteHistory, setSiteHistory] = useState<Record<string, SiteHistoryState>>({});
  // Alt+N 的确认改用应用内弹层（原生 dialog.showMessageBox 与本应用外观格格不入）。
  // 存 resolve 而不是布尔：调用方仍是 `await` 的形态，业务逻辑不必改写成回调。
  const [pendingNewSession, setPendingNewSession] = useState<PendingSessionConfirmation | null>(null);
  const [statuses, setStatuses] = useState<Record<string, SiteStatus>>({});
  const [health, setHealth] = useState<Partial<Record<string, SiteHealth>>>({});
  const [layout, setLayout] = useState<LayoutState>(INITIAL_LAYOUT);
  const { text, setText, revision: draftRevision, clearSent } = usePromptDraft();
  const [auxiliaryWorkBusy, setAuxiliaryBusy] = useState(false);
  const [panelState, setPanelState] = useState<WorkspacePanelState>(null);
  const [surface, setSurface] = useState<DesktopSurface>("sites");
  const [questionHistoryOpen, setQuestionHistoryOpen] = useState(false);
  const [questionReadRequest, setQuestionReadRequest] = useState<QuestionReadingRequest | null>(null);
  const [bootstrapProgress, setBootstrapProgress] = useState<QuestionRunProgress | null>(null);
  const [comparisonDrafts] = useState(createComparisonDraftStore);
  const [librarySession] = useState(createLibrarySessionStore);
  const [libraryBlocking, setLibraryBlocking] = useState(false);
  const blockLibrary = useCallback((value: boolean) => { if (value) commandActions.current = {}; setLibraryBlocking(value); }, []);
  const [questionHistoryBlocking, setQuestionHistoryBlocking] = useState(false);
  const closeQuestionHistory = (): void => { setQuestionReadRequest(null); setQuestionHistoryOpen(false); };
  const archiveNavigation = useArchiveNavigation();
  const [settingsBlocking, setSettingsBlocking] = useState(false);
  const blockSettings = useCallback((value: boolean) => { if (value) commandActions.current = {}; setSettingsBlocking(value); }, []);
  const [settingsSection, setSettingsSection] = useState<{ section: "overview" | "drive-diagnostics" | "data" | "display"; request: number }>({ section: "overview", request: 0 });
  const [commandMode, setCommandMode] = useState<CommandPaletteMode>("commands");
  const [syncStatus, setSyncStatus] = useState<SyncStatus>(INITIAL_SYNC);
  const [runtime, setRuntime] = useState<RuntimeInfo>(INITIAL_RUNTIME);
  const [promptLibrary, setPromptLibrary] = useState<PromptLibraryState>(INITIAL_LIBRARY);
  const templateDeletion = useTemplateDeletion(promptLibrary, setPromptLibrary, copy);
  const [completionNotifications, setCompletionNotifications] = useState(() =>
    loadCompletionNotifications(window.localStorage)
  );
  const { announcement, announce: setAnnouncement, clearNotice, healthFeedback, noteHealth } = useFeedback();
  const { checking: healthChecking, refresh: refreshSiteHealth } = useSiteHealthRefresh(setHealth, () => setAnnouncement(copy.healthRequestFailed));
  const [pageInputMethod, setPageInputMethod] = useState<"keyboard" | "pointer">("pointer");
  const drawerOpen = panelState !== null;
  if (panelState) lastOpenPanel.current = panelState;
  const workspaceFlow = useWorkspaceFlow(sites, copy.workspaceActionFailed, setAnnouncement);
  const { workspace, selected } = workspaceFlow;
  const changePanelState = (value: WorkspacePanelState): void => {
    if (value) { setQuestionHistoryOpen(false); imageSelection.setOpen(false); }
    setPanelState(value);
  };
  const openPanel = (tab: WorkspacePanelTab, inputMethod: "pointer" | "keyboard"): void => {
    changeSurface("sites");
    changePanelState(openWorkspacePanel(tab, inputMethod));
    if (tab === "health") void refreshSiteHealth(workspace.selectedSites);
  };
  const changeDrawerOpen = (value: boolean): void => {
    changePanelState(value ? openWorkspacePanel("sites", "pointer") : null);
  };
  const synthesis = useSynthesisFlow(actionLock.current!);
  const auxiliaryBusy = auxiliaryWorkBusy || synthesis.runState !== "idle";
  const participation = useSiteParticipation({ opened: workspace.selectedSites, ready: bootstrapPhase === 'ready',
    get busy() { return actionLock.current!.busy; }, openPages: async next => {
      const accepted = await actionLock.current!.run(() => workspaceFlow.openPages(next));
      if (!accepted) throw new Error('operation_busy');
      return accepted;
    },
    onError: () => setAnnouncement(copy.workspaceActionFailed) });
  const participating = useMemo(() => new Set(participation.participating), [participation.participating]);
  const archiveCapture = useArchiveCapture({ sites, selected: participating, prompt: text });
  const broadcast = useBroadcastFlow(
    () => setAnnouncement(copy.failed),
    archiveCapture.remember,
    archiveCapture.invalidate,
    (run) => setAnnouncement(broadcastFeedback(copy, run))
  );
  const { runState } = broadcast;
  const runProgress = useQuestionRunProgress(broadcast.runId, bootstrapProgress);
  const pageClose = useSitePageClose({ copy, sites, busy: runState !== 'idle' || auxiliaryBusy || participation.pending, api: shell,
    lock: actionLock.current!, onOpen: () => { commandActions.current = {}; changeSurface('confirmation'); },
    onClose: () => { changeSurface('sites'); restoreWorkbenchFocus(); }, onWorkspace: workspaceFlow.accept, onAnnounce: setAnnouncement });
  const retryReview = useBroadcastRetryReview({copy, sites, flow: broadcast, lock: actionLock.current!,
    busy: runState !== "idle" || auxiliaryBusy, onOpen: () => { changeSurface("sites"); changeSurface("confirmation"); },
    onClose: () => changeSurface("sites"), onInspect: (site, active) => inspectBroadcastSite(site, {
      isSelected: key => workspaceFlow.currentSelection().includes(key), active, focus: async key => {
        const accepted = await shell.inspectSite(key);
        if (accepted === true && active()) { changeSurface("sites"); if (drawerOpen) changeDrawerOpen(false); }
        return accepted;
      },
      unavailable: key => { changeSurface("sites"); openPanel("sites", "keyboard"); setAnnouncement(formatCopy(copy.retrySiteClosed, {site: sites.find(item => item.key === key)?.label ?? key})); }
    })});
  const imageSelection = useImageSelection(copy, runState === "idle" && !auxiliaryBusy, setAnnouncement);
  const synthesisRecovery = useSynthesisRecovery(copy, synthesis,
    () => { runProgress.invalidate(); broadcast.invalidate(); changeSurface("sites"); },
    () => { archiveNavigation.clear(); changeSurface("archive"); });
  const { images, open: imageTrayOpen } = imageSelection;
  const display = useDisplayPreferences(INITIAL_DISPLAY, () => setAnnouncement(copy.displayPreferencesFailed));
  const acceptDisplayPreferences = display.accept;
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
      void display.save(INITIAL_DISPLAY)
        .catch(() => setAnnouncement(copy.displayPreferencesFailed));
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
    const offLayout = shell.onLayout((next) => {
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
    });
    const offDisplay = shell.onDisplayPreferences(acceptDisplayPreferences);
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

  const { composer, drawerPresent } = useWorkspaceMotion(surface, drawerOpen, lastOpenPanel.current.inputMethod, imageSelection.present, { layout, density: display.value.density, covered: surface === 'confirmation' });
  const composerExpanded = composer.expanded;
  useEffect(() => {
    saveCompletionNotifications(window.localStorage, completionNotifications);
    shell.setCompletionNotifications(completionNotifications);
  }, [completionNotifications]);

  const scopeLabel = useMemo(
    () => scopeDisplayName(participation.participating, workspace.groups, copy),
    [copy, workspace.groups, participation.participating]
  );
  const healthAttention = useMemo(
    () => new Set([
      ...Object.values(statuses).filter((status) => selected.has(status.site) && ["warning", "failed", "crashed"].includes(status.phase)).map((status) => status.site),
      ...Object.values(health).filter((item) => item && selected.has(item.site) && ["sign-in", "error"].includes(item.state)).map((item) => item!.site)
    ]).size,
    [health, selected, statuses]
  );
  const { unsupportedSites, imageWarning } = imageSupportWarning(copy, images.length, participating, sites, navigator.language);

  const submit = async (): Promise<void> => {
    const prompt = text.trim();
    const sentRevision = draftRevision.current;
    if (!prompt || !participation.currentSites().length || runState !== "idle" || participation.pending) return;
    await actionLock.current!.run(async () => {
      if (imageWarning) {
        setAnnouncement(imageWarning);
        imageSelection.setOpen(false);
        changeDrawerOpen(true);
        return;
      }
      imageSelection.invalidateAndClose();
      const completed = await broadcast.send({
        text: prompt,
        tier: workspace.tier,
        sites: participation.currentSites(),
        images
      });
      if (completed && [...completed.results.values()].some((result) => result.ok)) {
        clearSent(sentRevision);
      }
    });
  };

  const setMode = (mode: "overview" | "focus", focused = layout.focused): void => {
    shell.setLayout(mode, focused);
  };

  const changeSurface = (value: DesktopSurface): void => {
    if (value !== "sites") {
      setQuestionHistoryOpen(false);
      imageSelection.invalidateAndClose();
      if (value !== "confirmation" && value !== "question-history") composer.reset();
      if (drawerOpen) changeDrawerOpen(false);
    }
    setSurface(value);
    shell.setSurface(value);
  };
  const runAuxiliary = async (action: () => Promise<void>): Promise<void> => {
    if (runState !== "idle") return;
    await actionLock.current!.run(async () => {
      setAuxiliaryBusy(true);
      try {
        await action();
      } finally {
        setAuxiliaryBusy(false);
      }
    });
  };
  const {collectAndCopy, collectSynthesis, collectAndCompare} = archiveCollectionActions({copy,
    capture: archiveCapture, synthesis, runAuxiliary, announce: setAnnouncement,
    openArchive: (id, mode) => { if (id && mode === 'read') archiveNavigation.history(id, 'read'); else archiveNavigation.collection(id); changeSurface("archive"); }});
  const startNewSession = async (): Promise<void> => {
    if (pendingNewSession || auxiliaryBusy || runState !== "idle") return;
    const selectedSites = [...selected];
    if (!selectedSites.length) return;
    const approved = await confirmNewSession(selectedSites.length, setPendingNewSession, changeSurface);
    if (!approved) return;
    await runAuxiliary(async () => {
      broadcast.invalidate();
      runProgress.invalidate();
      archiveCapture.invalidate();
      try {
        const results = await shell.newSession(selectedSites);
        const failed = results.filter((result) => !result.ok).length;
        setAnnouncement(failed
          ? formatCopy(copy.newSessionPartial, { ok: results.length - failed, failed })
          : formatCopy(copy.newSessionDone, { count: results.length }));
      } catch {
        workspaceFlow.recover();
      }
    });
  };
  const showGroupMenu = async (): Promise<void> => {
    try {
      const id = await shell.showGroupMenu();
      const group = workspace.groups.find((candidate) => candidate.id === id);
      if (group) void participation.change(group.sites);
    } catch {
      setAnnouncement(copy.workspaceActionFailed);
    }
  };
  const showMoreMenu = async (): Promise<void> => {
    try {
      const command = await shell.showCommandMenu(MORE_MENU_IDS.filter((id) => !!commandActions.current[id]));
      if (command) executeCommand(command, commandActions.current);
    } catch {
      setAnnouncement(copy.workspaceActionFailed);
    }
  };

  const openCommandSurface = (mode: CommandPaletteMode): void => {
    setCommandMode(mode);
    changeSurface("commands");
  };
  const showPage = (page: number): void => {
    changeSurface("sites");
    requestedPage.current = { page, inputMethod: "keyboard" };
    setPageInputMethod("keyboard");
    setAnnouncement(formatCopy(copy.sitePageChanged, { page: page + 1, total: layout.pageCount }));
    shell.setPage(page);
  };
  const nextUnfinished = nextSiteForStatus(
    workspace.selectedSites, layout.focused, statuses, "unfinished"
  );
  const nextFailed = nextSiteForStatus(
    workspace.selectedSites, layout.focused, statuses, "failed"
  );
  const focusSite = (site: SiteDefinition["key"]): void => {
    changeSurface("sites");
    if (drawerOpen) changeDrawerOpen(false);
    setMode("focus", site);
  };
  const openLatestReleasePage = (): Promise<void> => shell.openExternal(LATEST_RELEASE_URL);
  const openSettings = (section: typeof settingsSection.section): void => {
    setSettingsSection(value => ({ section, request: value.request + 1 }));
    changeSurface("settings");
  };
  const checkForUpdates = (): void => {
    changeSurface("sites");
    void openLatestReleasePage()
      .then(() => setAnnouncement(copy.updatePageOpened))
      .catch(() => setAnnouncement(copy.updatePageFailed));
  };

  commandActions.current = pendingNewSession || questionHistoryBlocking || settingsBlocking || libraryBlocking || retryReview.open || pageClose.blocking || participation.pending ? {} : {
    "open-command-palette": () => openCommandSurface("commands"),
    "open-sites": () => {
      openPanel("sites", "keyboard");
    },
    "open-site-health": () => {
      openPanel("health", "keyboard");
    },
    ...(layout.pageCount >= 1 ? { "show-page-1": () => showPage(0) } : {}),
    ...(layout.pageCount >= 2 ? { "show-page-2": () => showPage(1) } : {}),
    ...(layout.pageCount >= 3 ? { "show-page-3": () => showPage(2) } : {}),
    // 翻页/换焦点交给主进程的 ViewManager，渲染层不重算（重算必与主进程漂开）
    ...(layout.pageCount > 1 ? {
      "next-page": () => { changeSurface("sites"); shell.stepPage(1); },
      "previous-page": () => { changeSurface("sites"); shell.stepPage(-1); }
    } : {}),
    ...(selected.size > 1 ? {
      "next-site": () => { changeSurface("sites"); shell.stepSite(1); },
      "previous-site": () => { changeSurface("sites"); shell.stepSite(-1); }
    } : {}),
    // 站内后退/前进作用于当前聚焦的站点；能不能退由主进程按真实导航历史判定。
    ...(siteHistory[layout.focused]?.back ? { "site-back": () => { changeSurface("sites"); shell.stepHistory(-1); } } : {}),
    ...(siteHistory[layout.focused]?.forward ? { "site-forward": () => { changeSurface("sites"); shell.stepHistory(1); } } : {}),
    "focus-prompt": () => {
      changeSurface("sites");
      if (drawerOpen) changeDrawerOpen(false);
      focusPromptForEditing(promptRef, composer.setExpanded);
    },
    "set-think": () => { changeSurface("sites"); void workspaceFlow.changeTier("think"); },
    "set-fast": () => { changeSurface("sites"); void workspaceFlow.changeTier("fast"); },
    ...(participating.size > 0 ? { "collect-answers": () => { changeSurface("sites"); void collectAndCopy(); } } : {}),
    "collect-compare": () => { changeSurface("sites"); void collectAndCompare(); },
    "open-question-history": () => { changeSurface("sites"); changePanelState(null); imageSelection.setOpen(false); setQuestionReadRequest(null); setQuestionHistoryOpen(true); },
    "open-archive": () => { archiveNavigation.clear(); changeSurface("archive"); },
    ...(synthesis.pending ? { "collect-synthesis": () => { changeSurface("sites"); void collectSynthesis(); } } : {}),
    ...(broadcast.retrySites.length > 0 ? {
      "retry-failed": () => retryReview.request()
    } : {}),
    ...(nextUnfinished ? { "next-unfinished": () => focusSite(nextUnfinished) } : {}),
    ...(nextFailed ? { "next-failed": () => focusSite(nextFailed) } : {}),
    ...(selected.size > 0 ? { "new-session": () => { void startNewSession(); } } : {}),
    "open-settings": () => openSettings("overview"),
    "open-drive-diagnostics": () => openSettings("drive-diagnostics"),
    "open-display-settings": () => openSettings("display"),
    "open-data-settings": () => openSettings("data"),
    "open-shortcuts": () => openCommandSurface("shortcuts"),
    "open-getting-started": () => openCommandSurface("guide"),
    "check-updates": checkForUpdates
  };
  const availableCommands = COMMANDS.filter((command) => !!commandActions.current[command.id]);
  // 站内后退/前进的可用性来自主进程的真实导航历史。聚焦站点变了、或该站页面阶段变了
  // （= 刚导航过），都要重算——否则命令面板里这两条的可用状态会停在上一次。
  useEffect(() => {
    let cancelled = false;
    void shell.siteHistoryState()
      .then((state) => { if (!cancelled) setSiteHistory(state); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [layout.focused, statuses, surface]);
  // 菜单会随显示偏好重建，每次进速查都重新读一次真实菜单——速查因此不可能与菜单漂开。
  useEffect(() => {
    if (surface !== "commands") return;
    let cancelled = false;
    void shell.menuShortcuts()
      .then((items) => { if (!cancelled) setMenuShortcuts(items); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [surface]);

  if (bootstrapPhase !== "ready") {
    return (
      <BootstrapStateView
        copy={copy}
        phase={bootstrapPhase}
        announcement={announcement}
        onRetry={() => { void bootstrap(); }}
      />
    );
  }

  if (surface === "archive") {
    return <div className="surface-stage"><ArchiveSurface copy={copy} locale={navigator.language} sites={sites} synthesisSites={sites.filter((site) => selected.has(site.key))} defaultTier={workspace.tier} comparisonId={archiveNavigation.comparisonId} preferredId={synthesisRecovery.editorRequest?.archiveId ?? archiveNavigation.preferredId ?? synthesis.pending?.archiveId ?? null} synthesisDrafts={synthesis.drafts} synthesisEditorRequest={synthesisRecovery.editorRequest} onSynthesisEditorOpened={synthesisRecovery.consumeEditorRequest} pendingSynthesis={synthesis.pending} synthesisCandidate={synthesis.candidate} synthesisSession={synthesis.session} comparisonDrafts={comparisonDrafts} session={librarySession} navigationRevision={archiveNavigation.revision} onBlockingChange={blockLibrary} onClose={() => changeSurface("sites")} onCapture={archiveCapture.capture} onSendSynthesis={synthesisRecovery.send} onCollectSynthesis={async () => { await synthesis.collect(); }} onSaveSynthesis={synthesis.save} /></div>;
  }
  if (surface === "settings") {
    return <div className="surface-stage"><SettingsWorkspace copy={copy} locale={navigator.language} runtime={runtime} status={syncStatus} onBlockingChange={blockSettings} initialSection={settingsSection.section} sectionRequest={settingsSection.request} display={display.value} onDisplayChange={display.save} completionNotifications={completionNotifications} onCompletionNotificationsChange={setCompletionNotifications} onCheckUpdates={openLatestReleasePage} onStatus={setSyncStatus} onAnnounce={setAnnouncement} onLocalReset={() => { workspaceFlow.invalidate(); pageClose.invalidate(); runProgress.invalidate(); setBootstrapProgress(null); setQuestionReadRequest(null); comparisonDrafts.clear(); librarySession.clear(); participation.reset(); composer.reset(); synthesisRecovery.clear(); archiveNavigation.clear(); resetLocalSession(window.localStorage, { setText, imageSelection, broadcast, archiveCapture, synthesis }); void bootstrap(); }} onClose={() => changeSurface("sites")} /></div>;
  }
  if (surface === "commands") {
    return (
      <CommandPalette
        copy={copy}
        commands={availableCommands}
            menuShortcuts={menuShortcuts}
        groups={workspace.groups}
        library={templateDeletion.library}
        draft={text}
        isMac={isMac}
        mode={commandMode}
        onModeChange={setCommandMode}
        onExecute={(id) => executeCommand(id, commandActions.current)}
        onApplyGroup={(id) => {
          const group = workspace.groups.find((candidate) => candidate.id === id);
          if (!group) return;
          void participation.change(group.sites);
          changeSurface("sites");
        }}
        onInsertPrompt={(value) => {
          setText(value);
          changeSurface("sites");
          focusPromptForEditing(promptRef, composer.setExpanded);
        }}
        onSaveTemplate={async (input) => {
          try {
            const library = await shell.savePromptTemplate(input);
            setPromptLibrary(library); setAnnouncement(copy.templateSaved, true, true);
            return true;
          } catch { setAnnouncement(copy.promptLibrarySaveFailed); return false; }
        }}
        onDeleteTemplate={templateDeletion.request}
        onClose={() => changeSurface("sites")}
      />
    );
  }

  return (
    <main className={`app-shell${composer.reservedExpanded ? " is-composer-expanded" : ""}${drawerOpen ? " has-drawer" : ""}`}>
      <CommandBar
        copy={copy}
        promptRef={promptRef}
        text={text}
        tier={workspace.tier}
        runState={synthesis.runState !== "idle" ? synthesis.runState : runState}
        auxiliaryBusy={auxiliaryBusy || participation.pending}
        layoutMode={layout.mode}
        automaticFocus={layout.automaticFocus}
        selectedCount={participating.size}
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
            open={imageTrayOpen}
            present={imageSelection.present}
            disabled={runState !== "idle" || auxiliaryBusy}
            warning={imageWarning}
            warningCount={unsupportedSites.length}
            error={imageSelection.error}
            onOpenChange={(open) => { if (open) { changeSurface("sites"); changePanelState(null); setQuestionHistoryOpen(false); } imageSelection.setOpen(open); }}
            onFiles={(files) => { void imageSelection.choose(files); }}
            onRemove={imageSelection.remove}
            onAdjustScope={() => { imageSelection.setOpen(false); changeDrawerOpen(true); }}
          />
        )}
        pageControl={layout.pageCount > 1 ? <PageTabs copy={copy} isMac={isMac} sites={sites} selectedSites={workspace.selectedSites}
          statuses={statuses} page={layout.page} inputMethod={pageInputMethod} summaryRunId={broadcast.runId ?? runProgress.runId}
          onPageChange={(page, inputMethod) => {
            requestedPage.current = { page, inputMethod }; setPageInputMethod(inputMethod);
            setAnnouncement(formatCopy(copy.sitePageChanged, { page: page + 1, total: layout.pageCount })); shell.setPage(page);
          }}/> : null}
        sendBlockedReason={imageWarning}
        synthesisPending={!!synthesis.pending}
        syncStatus={syncStatus}
        isMac={isMac}
        expanded={composerExpanded}
        reservedExpanded={composer.reservedExpanded}
        revealedExpanded={composer.revealedExpanded}
        draftRevision={draftRevision.current} onTextChange={setText}
        onCompare={workspace.selectedSites.filter((site) => statuses[site]?.phase === "complete").length >= 2 ? () => { void collectAndCompare(); } : undefined}
        onSubmit={() => void submit()}
        onCancel={synthesis.runState !== "idle" ? synthesis.cancel : broadcast.cancel}
        onTierChange={workspaceFlow.changeTier}
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
      <WorkspaceProgress copy={copy} statuses={statuses} runId={broadcast.runId ?? runProgress.runId}
        activeSites={broadcast.runId ? broadcast.activeSites : runProgress.value?.answers.map(answer => answer.site) ?? []}
        progress={runProgress.value} onRead={() => {
          const progress = runProgress.value;
          if (!progress?.questionId || !commandActions.current['open-question-history']) return;
          executeCommand('open-question-history', commandActions.current);
          setQuestionReadRequest(old => ({ request: (old?.request ?? 0) + 1, questionId: progress.questionId!, answerId: progress.answers.find(answer => answer.hasText)?.id }));
        }}/>
      {drawerPresent ? (
        <WorkspaceDrawer
          copy={copy}
          sites={sites}
          selected={selected}
          participating={participating} participationBusy={runState !== 'idle' || auxiliaryBusy || participation.pending}
          groups={workspace.groups}
          statuses={statuses}
          health={health}
          healthChecking={healthChecking}
          open={drawerOpen}
          state={panelState ?? lastOpenPanel.current}
          onStateChange={changePanelState}
          onSelectionChange={value => { void participation.reorderOpened(value); }}
          onParticipationChange={value => { void participation.change(value); }}
          onCloseSitePage={site => { void pageClose.request(site); }}
          onSaveGroup={name => workspaceFlow.saveGroup(name, participation.currentSites())}
          onDeleteGroup={workspaceFlow.deleteGroup}
          onCheckHealth={(keys) => { void refreshSiteHealth(keys); }}
          onFocusSite={(site) => {
            changePanelState(null);
            setMode("focus", site);
          }}
          {...siteHealthActions({ copy, sites, selected, runtime, statuses, health, setHealth, noteHealth })}
          healthFeedback={healthFeedback}
        />
      ) : null}
      <SiteFrames
        copy={copy}
        sites={sites}
        statuses={statuses}
        layout={layout}
        selected={selected}
        participating={participating} participationBusy={runState !== 'idle' || auxiliaryBusy || participation.pending}
        onToggle={site => { void participation.toggle(site); }}
        onFocus={(site) => setMode("focus", site)}
        onReload={(site) => { void shell.reloadSite(site); }}
        retrySites={broadcast.retrySites}
        uncertainSites={broadcast.uncertainSites}
        retryDisabled={runState !== "idle" || auxiliaryBusy}
        onRetry={retryReview.request}
        history={siteHistory}
        onBack={(site) => shell.stepHistory(-1, site)}
      />
      <QuestionHistory active={surface === 'sites'} openRequest={questionReadRequest} onBlockingChange={setQuestionHistoryBlocking} open={questionHistoryOpen} copy={copy} sites={sites} draft={text} draftImageCount={imageSelection.images.length} busy={runState !== "idle" || auxiliaryBusy} onArchiveCreated={(record, mode, selection) => { if (runState === "idle" && !auxiliaryBusy) requestDecisionNavigation(() => { archiveNavigation.history(record.id, mode); changeSurface("archive"); }); }} onOpen={() => executeCommand("open-question-history", commandActions.current)} onClose={closeQuestionHistory} onDraft={value => { imageSelection.clear(); setText(value); focusPromptForEditing(promptRef, composer.setExpanded); }} />
      {retryReview.review}
      {pageClose.dialog}
      {pendingNewSession && (
        <ConfirmDialog
          copy={copy}
          title={copy.newSessionConfirmTitle}
          message={formatCopy(copy.newSessionConfirmMessage, { count: pendingNewSession.count })}
          confirmLabel={copy.newSessionConfirmAction}
          cancelLabel={copy.newSessionKeepCurrent}
          onConfirm={() => pendingNewSession.decide(true)}
          onCancel={() => pendingNewSession.decide(false)}
        />
      )}
    </main>
  );
}

document.documentElement.lang = resolveLocale(navigator.language) === "zhCN"
  ? "zh-CN"
  : resolveLocale(navigator.language) === "zhTW" ? "zh-TW" : "en";
document.documentElement.dataset.platform = currentPlatform;
document.title = getCopy(navigator.language).appTitle;
createRoot(document.getElementById("root")!).render(<StrictMode><FeedbackProvider copy={getCopy(navigator.language)}><App /></FeedbackProvider></StrictMode>);
