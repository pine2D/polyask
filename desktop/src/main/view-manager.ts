import { BrowserWindow, WebContentsView, session, type WebContents } from "electron";

import type { LayoutMode, SiteDefinition, SiteKey } from "../shared/contracts";
import type { DesktopUiState } from "../shared/desktop-ui-state";
import type { DisplayPreferences } from "../shared/display";
import type { DesktopSurface, LayoutState, SiteCollectionResult, SiteHistoryState, SiteResponseEnvelope, SiteResult, SiteStatus, SiteSubmittedResponse, SubmitSiteCommand, WasSubmittedSiteCommand } from "../shared/protocol";
import type { SiteHealth } from "../shared/site-health";
import type { TierPreset, TierPresetAction } from "../shared/tier-presets";
import { SITE_PARTITION, type DiagnosticSiteInput } from "./diagnostics";
import { ensureSiteViews } from "./ensure-site-views";
import type { GenerationMonitor } from "./generation-monitor";
import { GenerationWatcher } from "./generation-watcher";
import { coverSitesForHistory } from "./question-layout";
import { bindShellContents } from "./shell-contents-bindings";
import { SiteCommandOperations } from "./site-command-operations";
import { SiteFindController } from "./site-find";
import { bindSiteFocus } from "./site-focus";
import type { SiteHistoryAccess } from "./site-history-access";
import { SiteNavigationController } from "./site-navigation-controller";
import { CaptureReleaseGuards } from "./site-page-protection";
import type { CollectedSiteSnapshot } from "./site-snapshot-service";
import { SiteStatusRegistry } from "./site-status-registry";
import { transitionSiteSurface } from "./site-surface";
import { createSiteView, diagnosticSitesForViews, type SiteWebRtcPolicy } from "./site-view";
import { SiteWorkspaceState } from "./site-workspace-state";
import { SiteZoomController } from "./site-zoom";
import { SITES } from "./sites";
import type { StabilityEventInput } from "./stability-monitor";
import type { sitePageCloseReason } from "./view-reclamation";
import { stackOrder } from "./view-visibility";
import { applyWorkspaceLayout } from "./workspace-layout";

// Permissions the nine site views may use. Everything else — camera, microphone,
// geolocation, MIDI, notifications, clipboard-read, window-management — stays
// denied. Keep docs/desktop.md in step with this list.
const SITE_PERMISSION_ALLOWLIST = new Set<string>([
  "clipboard-sanitized-write",
  "fullscreen",
  "pointerLock"
]);

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
  private readonly views = new Map<SiteKey, WebContentsView>();
  private readonly attached = new Set<SiteKey>();
  private readonly workspace: SiteWorkspaceState;
  private readonly statuses: SiteStatusRegistry;
  private readonly operations: SiteCommandOperations;
  private readonly navigation: SiteNavigationController;
  private readonly generationWatcher: GenerationWatcher;
  private readonly captureGuards = new CaptureReleaseGuards();
  private readonly siteSession = session.fromPartition(SITE_PARTITION);
  readonly historyAccess: SiteHistoryAccess;
  readonly siteFind = new SiteFindController({
    targets: () => this.workspace.selected.map((site) => ({ site, contents: this.views.get(site)?.webContents })),
    focused: () => this.workspace.focused,
    allowed: () => this.workspace.surface === "sites" && !this.historyAccess.panelOpen,
    focus: (site) => { this.setLayout(this.workspace.mode, site, false); },
    reserve: () => this.layout(),
    restoreFocus: () => this.focusCurrentSite(),
    publish: (state) => { if (!this.window.isDestroyed()) this.window.webContents.send("polyask:find-state", state); }
  });

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
    this.statuses = new SiteStatusRegistry((site) => this.workspace.isSiteVisible(site), this.onStatus, options.proxyAuthFailed);
    this.operations = new SiteCommandOperations({
      getView: (site) => this.views.get(site),
      statuses: this.statuses,
      isReloading: (site) => this.historyAccess.reloads.watching(site),
      isNavigatingOrReloading: (site) => this.historyAccess.navigating(site) || this.historyAccess.reloads.watching(site),
      isBusyForPreset: (site) => !!this.sitePageCloseReason(site),
      replaceView: (definition, view, url) => this.replaceView(definition, view, url)
    });
    this.navigation = new SiteNavigationController({
      siteSession: this.siteSession,
      getView: (site) => this.views.get(site),
      commands: this.operations.channel,
      statuses: this.statuses,
      invalidateGeneration: (site) => this.invalidateGeneration(site),
      generationAttempt: (site) => this.generationWatcher.attempt(site),
      relayout: () => this.layout()
    });
    this.historyAccess = this.navigation.historyAccess;
    this.generationWatcher = new GenerationWatcher({
      getView: (site) => this.views.get(site),
      commands: this.operations.channel,
      currentStatus: (site) => this.statuses.current(site),
      markStatus: (status) => this.markStatus(status)
    });
    this.siteSession.setPermissionCheckHandler(
      (_contents, permission) => SITE_PERMISSION_ALLOWLIST.has(permission)
    );
    this.siteSession.setPermissionRequestHandler((_contents, permission, callback) =>
      callback(SITE_PERMISSION_ALLOWLIST.has(permission)));

    ensureSiteViews(this.workspace.selected, this.views, (definition) => this.createView(definition));
    this.reconcileViews();
    this.layout();
    window.on("resize", () => this.layout());
    window.on("restore", () => this.layout());
    bindShellContents(window.webContents, {
      relayout: () => this.layout(),
      reset: () => {
        this.siteFind.close(false);
        this.workspace.resetOverlays();
        this.historyAccess.panelOpen = false;
        if (this.workspace.surface === "sites") this.layout();
        else this.setSurface("sites");
      }
    });
    window.on("closed", () => this.dispose());
  }

  getStatuses(): SiteStatus[] { return this.statuses.all(); }
  getLayout(): LayoutState { return this.workspace.getLayout(); }
  getDisplayPreferences(): DisplayPreferences { return this.workspace.display; }

  getUiState(): DesktopUiState {
    return this.workspace.captureUiState(this.window.getNormalBounds(), this.window.isMaximized(), this.siteZoom.snapshot());
  }

  getDiagnosticSites(): DiagnosticSiteInput[] {
    return diagnosticSitesForViews(SITES, this.views, this.siteSession, this.attached);
  }

  setDisplayPreferences(value: DisplayPreferences): void { this.workspace.display = value; this.layout(); }
  relayout(): void { this.layout(); }
  setComposerExpanded(value: boolean): void { if (this.workspace.setComposerExpanded(value)) this.layout(); }
  setDrawerOpen(value: boolean): void { if (this.workspace.setDrawerOpen(value)) this.layout(); }

  setSelection(sites: readonly SiteKey[]): void {
    this.workspace.setSelection(sites);
    this.reconcileViews();
    this.clearVisibleUnread();
    this.layout();
  }

  setPage(value: number): void {
    if (!this.workspace.setPage(value)) return;
    this.reconcileViews();
    this.clearVisibleUnread();
    this.layout();
  }

  setLayout(mode: LayoutMode, requestedFocus: SiteKey = this.workspace.focused, activate = true): boolean {
    const result = this.workspace.applyLayout(mode, requestedFocus, activate);
    if (!result.accepted) return false;
    this.reconcileViews();
    this.clearVisibleUnread();
    this.layout();
    if (result.shouldFocusSite) this.focusCurrentSite();
    return true;
  }

  setSurface(value: DesktopSurface): void {
    if (this.workspace.surface === value || this.window.isDestroyed()) return;
    const previous = this.workspace.surface;
    this.workspace.surface = value;
    this.siteFind.sync();
    transitionSiteSurface(previous, value, {
      detach: () => { for (const site of [...this.attached]) this.detach(site); },
      cover: (covered) => coverSitesForHistory(this.window, covered),
      restore: () => { this.reconcileViews(); this.clearVisibleUnread(); this.layout(); }
    });
  }

  focusCurrentSite(): void {
    if (this.window.isDestroyed() || this.workspace.surface !== "sites" || this.historyAccess.panelOpen) return;
    if (!this.workspace.selected.includes(this.workspace.focused)) return;
    const contents = this.views.get(this.workspace.focused)?.webContents;
    if (contents && !contents.isDestroyed()) contents.focus();
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

  canNavigateHistory(site: SiteKey): SiteHistoryState { return this.navigation.canNavigateHistory(site); }
  isConfirmationActive(): boolean { return this.workspace.isConfirmationActive(); }
  historyState(): Record<string, SiteHistoryState> { return this.navigation.historyState(this.workspace.selected); }
  reload(site: SiteKey, ignoreCache = false): boolean { return this.navigation.reload(site, ignoreCache); }
  async clearSiteData(site: SiteKey): Promise<boolean> { return this.navigation.clearSiteData(site); }
  checkHealth(sites: readonly SiteKey[]): Promise<SiteHealth[]> { return this.operations.checkHealth(sites); }
  sampleSnapshot(site: SiteKey, appVersion: string): Promise<CollectedSiteSnapshot> { return this.operations.sampleSnapshot(site, appVersion); }

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
    return this.captureGuards.closeReason(site, this.statuses, this.historyAccess.navigating(site), this.generationWatcher);
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

  watchGeneration(runId: string, site: SiteKey, resumed = false): void { this.generationWatcher.watch(runId, site, resumed); }
  onGenerationComplete(listener: GenerationMonitor["onComplete"]): void { this.generationWatcher.setOnComplete(listener); }
  invalidateGeneration(site: SiteKey): void { this.generationWatcher.invalidate(site); }
  cancelGenerationRun(sites?: readonly SiteKey[]): void { this.generationWatcher.cancel(sites); }

  owns(contents: WebContents): SiteKey | null {
    for (const [key, view] of this.views) {
      if (view.webContents.id === contents.id) return key;
    }
    return null;
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

  private replaceView(site: SiteDefinition, view: WebContentsView, url: string): void {
    if (this.views.get(site.key) !== view || this.window.isDestroyed()) return;
    this.detach(site.key);
    this.views.delete(site.key);
    if (!view.webContents.isDestroyed()) view.webContents.close();
    this.createView(site, url);
    this.reconcileViews();
    this.layout();
  }

  private createView(site: SiteDefinition, url: string = site.url): void {
    const view = createSiteView(site, {
      ...this.statuses.pageLifecycleCallbacks(site.key, this.onRuntimeEvent),
      onExternal: (target) => this.options.openExternal?.(target),
      webrtcPolicy: () => this.options.webrtcPolicy?.() ?? "default"
    });
    this.views.set(site.key, view);
    this.siteZoom.bind(site.key, view.webContents);
    bindSiteFocus(view.webContents, site.key, () => this.getLayout(), () => this.workspace.surface === "sites" && !this.historyAccess.panelOpen, (key) => this.setLayout(this.workspace.mode, key, false));
    if (this.workspace.surface === "sites" && this.workspace.selected.includes(site.key)) this.attach(site.key);
    this.statuses.updatePage({ site: site.key, phase: "loading" });
    this.historyAccess.initialLoad(site.key, view.webContents, url);
  }

  private layout(): void {
    if (this.window.isDestroyed() || this.workspace.surface !== "sites" || this.window.isMinimized()) return;
    const computed = this.workspace.computeViewportPlacements(
      this.window.getContentSize() as [number, number],
      this.window.webContents.getZoomFactor(),
      this.historyAccess.panelOpen,
      this.siteFind.state.open
    );
    if (!computed) return;
    for (const item of computed.currentPlacements) this.attach(item.key);
    applyWorkspaceLayout({
      views: this.views,
      placements: computed.placementsWithBackground,
      metrics: computed.metrics,
      zoom: computed.zoom,
      display: computed.display,
      siteZoom: this.siteZoom,
      mode: computed.renderedMode,
      focused: computed.focused
    }, this.siteFind.state.open);
    this.onLayout(this.getLayout());
    this.siteFind.sync();
    this.options.onUiStateChange?.(this.getUiState());
  }

  private clearVisibleUnread(): void {
    this.statuses.clearVisibleUnread(this.workspace.surface, this.workspace.visibleSites());
  }

  // 明确关页才释放资源，登录保留在持久化 session；发送、生成和答案采集结束前不关闭。
  releaseUnselectedViews(): void {
    if (this.window.isDestroyed()) return;
    this.captureGuards.reclaimUnselected({
      views: this.views,
      selected: this.workspace.selected,
      statuses: this.statuses,
      generationWatcher: this.generationWatcher,
      navigating: (site) => this.historyAccess.navigating(site),
      detach: (site) => this.detach(site)
    });
  }

  // 挂载全部已勾选站点（不只当前页）：未挂载视图视口恒 0×0，后台页会 composer_not_found。
  private reconcileViews(): void {
    if (this.workspace.surface !== "sites" || this.window.isDestroyed()) return;
    ensureSiteViews(this.workspace.selected, this.views, (definition) => this.createView(definition));
    this.releaseUnselectedViews();
    for (const site of stackOrder([...this.views.keys()], this.workspace.visibleSites())) {
      this.attach(site);
      this.views.get(site)!.setVisible(this.workspace.selected.includes(site));
    }
  }

  private attach(site: SiteKey): void {
    const view = this.views.get(site);
    if (!view) return;
    // 对已在视图树里的子视图，addChildView 原地提升到最顶层（幂等、children 不增长），不先 detach 防丢焦点。
    this.window.contentView.addChildView(view);
    this.attached.add(site);
  }

  private detach(site: SiteKey): void {
    const view = this.views.get(site);
    if (!view || !this.attached.has(site)) return;
    this.window.contentView.removeChildView(view);
    this.attached.delete(site);
  }

  private dispose(): void {
    this.siteFind.dispose();
    this.cancelGenerationRun();
    this.operations.dispose();
    for (const view of this.views.values()) {
      if (!view.webContents.isDestroyed()) view.webContents.close();
    }
    this.attached.clear();
    this.views.clear();
  }
}
