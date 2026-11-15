import { BrowserWindow, session, type WebContents } from "electron";

import type { LayoutMode, SiteKey } from "../shared/contracts";
import type { DesktopUiState } from "../shared/desktop-ui-state";
import type { DisplayPreferences } from "../shared/display";
import type {
  DesktopSurface,
  LayoutState,
  SiteCollectionResult,
  SiteHistoryState,
  SiteResponseEnvelope,
  SiteResult,
  SiteStatus,
  SiteSubmittedResponse,
  SubmitSiteCommand,
  WasSubmittedSiteCommand
} from "../shared/protocol";
import type { SiteHealth } from "../shared/site-health";
import type { TierPreset, TierPresetAction } from "../shared/tier-presets";
import { SITE_PARTITION, type DiagnosticSiteInput } from "./diagnostics";
import type { GenerationMonitor } from "./generation-monitor";
import { GenerationWatcher } from "./generation-watcher";
import { coverSitesForHistory } from "./question-layout";
import { bindShellWindowLifecycle } from "./shell-contents-bindings";
import { SiteCommandOperations } from "./site-command-operations";
import { createWorkspaceSiteFind, type SiteFindController } from "./site-find";
import type { SiteHistoryAccess } from "./site-history-access";
import { SiteNavigationController } from "./site-navigation-controller";
import { CaptureReleaseGuards } from "./site-page-protection";
import type { CollectedSiteSnapshot } from "./site-snapshot-service";
import { SiteStatusRegistry } from "./site-status-registry";
import { transitionSiteSurface } from "./site-surface";
import { createSiteView, diagnosticSitesForViews, type SiteWebRtcPolicy } from "./site-view";
import { SiteViewTree } from "./site-view-tree";
import { SiteWorkspaceState } from "./site-workspace-state";
import { SiteZoomController } from "./site-zoom";
import type { StabilityEventInput } from "./stability-monitor";
import type { sitePageCloseReason } from "./view-reclamation";

interface ViewManagerOptions {
  readonly initialUiState?: DesktopUiState;
  readonly selectedSites?: readonly SiteKey[];
  readonly onUiStateChange?: (state: DesktopUiState) => void;
  // 站点视图里点到的外部链接交给用户自己的浏览器；不接就是静默无反应（见 site-view.ts）。
  readonly openExternal?: (url: string) => void;
  // WebRTC IP 策略跟随已应用代理（proxy-runtime.webrtcPolicy）；生产装配必传（proxy-startup-wiring 守卫），未接按 Electron 默认。
  readonly webrtcPolicy?: () => SiteWebRtcPolicy;
  // 认证熔断已跳闸（ProxyAuth.authFailed）。Electron 44 下 HTTPS 隧道遇 407 报 -111 而非 -127，须在分类处覆盖成 proxy_auth_failed。
  readonly proxyAuthFailed?: () => boolean;
}

export class ViewManager {
  readonly siteZoom = new SiteZoomController(() => {
    this.siteFind.sync();
    this.options.onUiStateChange?.(this.getUiState());
  });
  private readonly viewTree: SiteViewTree;
  private readonly workspace: SiteWorkspaceState;
  private readonly statuses: SiteStatusRegistry;
  private readonly operations: SiteCommandOperations;
  private readonly navigation: SiteNavigationController;
  private readonly generationWatcher: GenerationWatcher;
  private readonly captureGuards = new CaptureReleaseGuards();
  private readonly siteSession = session.fromPartition(SITE_PARTITION);
  readonly historyAccess: SiteHistoryAccess;
  readonly siteFind: SiteFindController;

  constructor(
    private readonly window: BrowserWindow,
    private readonly onStatus: (status: SiteStatus) => void,
    private readonly onLayout: (layout: LayoutState) => void,
    private readonly onRuntimeEvent: (event: StabilityEventInput) => void = () => undefined,
    private readonly options: ViewManagerOptions = {}
  ) {
    this.workspace = new SiteWorkspaceState({
      selectedSites: options.selectedSites,
      initialUiState: options.initialUiState
    });
    this.siteZoom.restore(options.initialUiState?.siteZoom);
    this.statuses = new SiteStatusRegistry(
      (site) => this.workspace.isSiteVisible(site),
      this.onStatus,
      options.proxyAuthFailed
    );
    this.siteFind = createWorkspaceSiteFind({
      selectedSites: () => this.workspace.selected,
      contentsForSite: (site) => this.viewTree.views.get(site)?.webContents,
      focusedSite: () => this.workspace.focused,
      isAllowed: () => this.workspace.surface === "sites" && !this.historyAccess.panelOpen,
      focusWithoutActivating: (site) => {
        this.setLayout(this.workspace.mode, site, false);
      },
      relayout: () => this.viewTree.layout(),
      restoreFocus: () => this.focusCurrentSite(),
      window
    });
    this.viewTree = new SiteViewTree({
      window,
      siteSession: this.siteSession,
      workspace: this.workspace,
      statuses: this.statuses,
      siteZoom: this.siteZoom,
      siteFind: this.siteFind,
      getHistoryAccess: () => this.historyAccess,
      createSiteView,
      diagnosticSitesForViews,
      releaseUnselectedViews: () => this.releaseUnselectedViews(),
      setLayout: (mode, requestedFocus, activate) => this.setLayout(mode, requestedFocus, activate),
      onLayout: this.onLayout,
      onRuntimeEvent: this.onRuntimeEvent,
      getUiState: () => this.getUiState(),
      onUiStateChange: options.onUiStateChange,
      openExternal: options.openExternal,
      webrtcPolicy: () => this.options.webrtcPolicy?.() ?? "default"
    });
    this.operations = new SiteCommandOperations({
      getView: (site) => this.viewTree.views.get(site),
      statuses: this.statuses,
      isReloading: (site) => this.historyAccess.reloads.watching(site),
      isNavigatingOrReloading: (site) =>
        this.historyAccess.navigating(site) || this.historyAccess.reloads.watching(site),
      isBusyForPreset: (site) => !!this.sitePageCloseReason(site),
      replaceView: (definition, view, url) => this.viewTree.replaceView(definition, view, url)
    });
    this.navigation = new SiteNavigationController({
      siteSession: this.siteSession,
      getView: (site) => this.viewTree.views.get(site),
      commands: this.operations.channel,
      statuses: this.statuses,
      invalidateGeneration: (site) => this.invalidateGeneration(site),
      generationAttempt: (site) => this.generationWatcher.attempt(site),
      relayout: () => this.viewTree.layout()
    });
    this.historyAccess = this.navigation.historyAccess;
    this.generationWatcher = new GenerationWatcher({
      getView: (site) => this.viewTree.views.get(site),
      commands: this.operations.channel,
      currentStatus: (site) => this.statuses.current(site),
      markStatus: (status) => this.markStatus(status)
    });

    this.viewTree.initialize();
    bindShellWindowLifecycle(window, {
      relayout: () => this.viewTree.layout(),
      reset: () => {
        this.siteFind.close(false);
        this.workspace.resetOverlays();
        this.historyAccess.panelOpen = false;
        if (this.workspace.surface === "sites") this.viewTree.layout();
        else this.setSurface("sites");
      },
      dispose: () => this.dispose()
    });
  }

  getStatuses(): SiteStatus[] {
    return this.statuses.all();
  }

  getLayout(): LayoutState {
    return this.workspace.getLayout();
  }

  getDisplayPreferences(): DisplayPreferences {
    return this.workspace.display;
  }

  getUiState(): DesktopUiState {
    return this.workspace.captureUiState(
      this.window.getNormalBounds(),
      this.window.isMaximized(),
      this.siteZoom.snapshot()
    );
  }

  getDiagnosticSites(): DiagnosticSiteInput[] {
    return this.viewTree.getDiagnosticSites();
  }

  setDisplayPreferences(value: DisplayPreferences): void {
    this.workspace.display = value;
    this.viewTree.layout();
  }

  relayout(): void {
    this.viewTree.layout();
  }

  setComposerExpanded(value: boolean): void {
    if (this.workspace.setComposerExpanded(value)) this.viewTree.layout();
  }

  setDrawerOpen(value: boolean): void {
    if (this.workspace.setDrawerOpen(value)) this.viewTree.layout();
  }

  setSelection(sites: readonly SiteKey[]): void {
    this.workspace.setSelection(sites);
    this.viewTree.reconcileViews();
    this.clearVisibleUnread();
    this.viewTree.layout();
  }

  setPage(value: number): void {
    if (!this.workspace.setPage(value)) return;
    this.viewTree.reconcileViews();
    this.clearVisibleUnread();
    this.viewTree.layout();
  }

  setLayout(mode: LayoutMode, requestedFocus: SiteKey = this.workspace.focused, activate = true): boolean {
    const result = this.workspace.applyLayout(mode, requestedFocus, activate);
    if (!result.accepted) return false;
    this.viewTree.reconcileViews();
    this.clearVisibleUnread();
    this.viewTree.layout();
    if (result.shouldFocusSite) this.focusCurrentSite();
    return true;
  }

  setSurface(value: DesktopSurface): void {
    if (this.workspace.surface === value || this.window.isDestroyed()) return;
    const previous = this.workspace.surface;
    this.workspace.surface = value;
    this.siteFind.sync();
    transitionSiteSurface(previous, value, {
      detach: () => this.viewTree.detachAll(),
      cover: (covered) => coverSitesForHistory(this.window, covered),
      restore: () => {
        this.viewTree.reconcileViews();
        this.clearVisibleUnread();
        this.viewTree.layout();
      }
    });
  }

  focusCurrentSite(): void {
    this.viewTree.focusCurrentSite();
  }

  focusRelative(offset: -1 | 1): void {
    const next = this.workspace.relativeFocusTarget(offset);
    if (next) this.setLayout(next.mode, next.target);
  }

  pageRelative(offset: -1 | 1): void {
    const next = this.workspace.relativePageTarget(offset);
    if (next !== null) this.setPage(next);
  }

  pageDirect(page: number): void {
    if (this.workspace.canPageDirect(page)) this.setPage(page);
  }

  navigateHistory(site: SiteKey, offset: -1 | 1): boolean {
    return this.navigation.navigateHistory(site, offset, this.isConfirmationActive());
  }

  canNavigateHistory(site: SiteKey): SiteHistoryState {
    return this.navigation.canNavigateHistory(site);
  }

  isConfirmationActive(): boolean {
    return this.workspace.isConfirmationActive();
  }

  historyState(): Record<string, SiteHistoryState> {
    return this.navigation.historyState(this.workspace.selected);
  }

  reload(site: SiteKey, ignoreCache = false): boolean {
    return this.navigation.reload(site, ignoreCache);
  }

  async clearSiteData(site: SiteKey): Promise<boolean> {
    return this.navigation.clearSiteData(site);
  }

  checkHealth(sites: readonly SiteKey[]): Promise<SiteHealth[]> {
    return this.operations.checkHealth(sites);
  }

  sampleSnapshot(site: SiteKey, appVersion: string): Promise<CollectedSiteSnapshot> {
    return this.operations.sampleSnapshot(site, appVersion);
  }

  async navigate(site: SiteKey, url: string, until: "load" | "commit" = "load"): Promise<void> {
    await this.navigation.navigate(site, url, until);
  }

  setCapturePending(
    check: (site: SiteKey) => boolean,
    releaseConfirmed: (site: SiteKey) => boolean = () => false,
    invalidateRelease: (sites: readonly SiteKey[]) => void = () => {}
  ): void {
    this.captureGuards.update(check, releaseConfirmed, invalidateRelease);
  }

  markStatus(status: SiteStatus): void {
    this.statuses.markRun(status);
    void Promise.resolve().then(() => this.releaseUnselectedViews());
  }

  sitePageCloseReason(site: SiteKey): ReturnType<typeof sitePageCloseReason> {
    return this.captureGuards.closeReason(
      site,
      this.statuses,
      this.historyAccess.navigating(site),
      this.generationWatcher
    );
  }

  resetRunStatus(): void {
    this.cancelGenerationRun();
    this.statuses.resetRun();
    this.releaseUnselectedViews();
  }

  beginGenerationRun(runId: string, sites: readonly SiteKey[], submission = true): void {
    this.captureGuards.invalidateRelease(sites);
    const resumed = this.generationWatcher.beginRun(runId, sites, submission);
    if (submission) this.statuses.beginSubmission(resumed);
  }

  watchGeneration(runId: string, site: SiteKey, resumed = false): void {
    this.generationWatcher.watch(runId, site, resumed);
  }

  onGenerationComplete(listener: GenerationMonitor["onComplete"]): void {
    this.generationWatcher.setOnComplete(listener);
  }

  invalidateGeneration(site: SiteKey): void {
    this.generationWatcher.invalidate(site);
  }

  cancelGenerationRun(sites?: readonly SiteKey[]): void {
    this.generationWatcher.cancel(sites);
  }

  owns(contents: WebContents): SiteKey | null {
    return this.viewTree.owns(contents);
  }

  sendCommand(site: SiteKey, command: SubmitSiteCommand, signal: AbortSignal): Promise<SiteResult> {
    return this.operations.sendCommand(site, command, signal);
  }

  confirmSubmitted(site: SiteKey, command: WasSubmittedSiteCommand, signal: AbortSignal): Promise<SiteSubmittedResponse | null> {
    return this.operations.confirmSubmitted(site, command, signal);
  }

  collect(site: SiteKey, deadline: number): Promise<SiteCollectionResult> {
    return this.operations.collect(site, deadline);
  }

  readonly switchTier = (site: SiteKey, tier: "think" | "fast", deadline: number, preset?: TierPreset): Promise<SiteResult> =>
    this.operations.switchTier(site, tier, deadline, preset);

  readonly inspectPreset = (site: SiteKey, action: TierPresetAction, deadline: number) =>
    this.operations.inspectPreset(site, action, deadline);

  receiveResponse(sender: WebContents, envelope: SiteResponseEnvelope): void {
    this.operations.receiveResponse(sender, envelope);
  }

  private clearVisibleUnread(): void {
    this.statuses.clearVisibleUnread(this.workspace.surface, this.workspace.visibleSites());
  }

  // 明确关页才释放资源，登录保留在持久化 session；发送、生成和答案采集结束前不关闭。
  // 状态更新及采集落库后都会重查，不再等待下一次用户布局操作。
  releaseUnselectedViews(): void {
    if (this.window.isDestroyed()) return;
    this.captureGuards.reclaimUnselected({
      views: this.viewTree.views,
      selected: this.workspace.selected,
      statuses: this.statuses,
      generationWatcher: this.generationWatcher,
      navigating: (site) => this.historyAccess.navigating(site),
      detach: (site) => this.viewTree.detach(site)
    });
  }

  private dispose(): void {
    this.siteFind.dispose();
    this.cancelGenerationRun();
    this.operations.dispose();
    this.viewTree.dispose();
  }
}
