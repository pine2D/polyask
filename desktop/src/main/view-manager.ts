import { reclaimUnselectedViews } from "./view-reclamation";
import { historyPanelWidth, coverSitesForHistory } from "./question-layout";
import { transitionSiteSurface } from "./site-surface";
import { SiteHistoryAccess } from "./site-history-access";
import { clearSiteDataAndReload } from "./site-data-recovery";
import {
  BrowserWindow,
  WebContentsView,
  session,
  type WebContents
} from "electron";

import type { SiteDefinition, SiteKey, ViewPlacement } from "../shared/contracts";
import { captureSiteFocus, type DesktopUiState } from "../shared/desktop-ui-state";
import { normalizeSelection } from "../shared/workspace";
import {
  DEFAULT_DISPLAY_PREFERENCES,
  type DisplayPreferences
} from "../shared/display";
import { normalizeSubmitted, parseGenerationState } from "../shared/protocol";
import type {
  CollectSiteCommand,
  DesktopSurface,
  DiagnoseSiteCommand,
  GenerationSiteCommand,
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
import {
  buildSiteHealth,
  siteReloadAllowed,
  type SiteHealth,
  type SiteHealthPageState,
  type SiteHealthRunPhase
} from "../shared/site-health";
import {
  resolveFocusedSite,
  resolveSitePage,
  resolveSitePageIndex
} from "../shared/site-pages";
import {
  SITE_PARTITION,
  type DiagnosticSiteInput
} from "./diagnostics";
import {
  swapFocusedSite
} from "./layout";
import { GenerationMonitor, GENERATION_MISS_LIMIT } from "./generation-monitor";
import { clearProbeTracking, generationObservationStatus, scheduleGenerationProbe } from "./generation-probe-scheduler";
import { navigationDisposition } from "./navigation";
import { SiteCommandChannel } from "./site-command-channel";
import { createSiteView, diagnosticSitesForViews } from "./site-view";
import { SITES } from "./sites";
import { beginSubmissionRun, preserveSubmission, effectiveStatus, markStatusRead, statusWithUnread } from "./status";
import { ensureSiteViews } from './ensure-site-views';
import { generationEndedForRelease, protectedPagePhase } from './site-page-protection';
import { sitePageCloseReason } from './view-reclamation';
import type { StabilityEventInput } from "./stability-monitor";
import { applyWorkspaceLayout, computeWorkspaceLayout } from "./workspace-layout";
import { stackOrder } from "./view-visibility";
import { SiteZoomController } from "./site-zoom";

// TODO(size-ratchet)：748 行，目标 ≤400——抽出 site-workspace-state（勾选/分页/布局纯状态）、
// site-status-registry（pageStatus/runStatus 合并与 unread）、generation-watcher（生成态轮询）三块无 Electron 依赖的纯逻辑。
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
}

export class ViewManager {
  readonly siteZoom = new SiteZoomController(() => this.options.onUiStateChange?.(this.getUiState()));
  private readonly views = new Map<SiteKey, WebContentsView>();
  private readonly attached = new Set<SiteKey>();
  private readonly pageStatus = new Map<SiteKey, SiteStatus>();
  private readonly runStatus = new Map<SiteKey, SiteStatus>();
  private readonly commands = new SiteCommandChannel();
  private capturePending: (site: SiteKey) => boolean = () => false;
  private captureReleaseConfirmed: (site: SiteKey) => boolean = () => false;
  private invalidateCaptureRelease: (sites: readonly SiteKey[]) => void = () => {};
  private readonly generation = new GenerationMonitor();
  private readonly generationTimers = new Map<SiteKey, NodeJS.Timeout>();
  private readonly generationDeadlines = new Map<SiteKey, number>();
  private readonly generationObserved = new Set<SiteKey>();
  private readonly generationMisses = new Map<SiteKey, number>();
  private mode: "overview" | "focus" = "overview";
  private renderedMode: "overview" | "focus" = "overview";
  private focused: SiteKey = "claude";
  private selected: SiteKey[] = SITES.map((site) => site.key);
  private page = 0;
  private pageCount = 3;
  private readonly focusedByPage = new Map<number, SiteKey>();
  private focusOrder: SiteKey[] = SITES.map((site) => site.key);
  private placements: readonly ViewPlacement[] = [];
  private display = DEFAULT_DISPLAY_PREFERENCES;
  private composerExpanded = false;
  private drawerOpen = false;
  private surface: DesktopSurface = "sites";
  private readonly siteSession = session.fromPartition(SITE_PARTITION);

  constructor(
    private readonly window: BrowserWindow,
    private readonly onStatus: (status: SiteStatus) => void,
    private readonly onLayout: (layout: LayoutState) => void,
    private readonly onRuntimeEvent: (event: StabilityEventInput) => void = () => undefined,
    private readonly options: ViewManagerOptions = {}
  ) {
    this.selected = normalizeSelection(options.selectedSites ?? SITES.map((site) => site.key));
    this.focusOrder = [...this.selected];
    this.focused = this.selected[0] ?? this.focused;
    const initial = options.initialUiState;
    this.siteZoom.restore(initial?.siteZoom);
    this.focusedByPage = new Map(Object.entries(initial?.focusedByPage ?? {}).map(([page, site]) => [Number(page), site]));
    if (initial) {
      this.mode = initial.layoutMode;
      this.page = initial.currentPage;
      const current = resolveSitePage(this.selected, this.page);
      this.page = current.page;
      this.pageCount = current.pageCount;
      // Restoring: the remembered site wins over the first selected site;
      // passing the startup focus as `current` would shadow that memory.
      this.focused = resolveFocusedSite(
        current.keys,
        this.focusedByPage.get(current.page) ?? this.focused,
        this.focused
      );
    }
    this.siteSession.setPermissionCheckHandler(
      (_contents, permission) => SITE_PERMISSION_ALLOWLIST.has(permission)
    );
    this.siteSession.setPermissionRequestHandler((_contents, permission, callback) =>
      callback(SITE_PERMISSION_ALLOWLIST.has(permission)));

    ensureSiteViews(this.selected, this.views, definition => this.createView(definition));
    this.reconcileViews();
    this.layout();
    window.on("resize", () => this.layout());
    window.on("restore", () => this.layout());
    window.webContents.on("zoom-changed", () => setTimeout(() => this.layout(), 0));
    window.on("closed", () => this.dispose());
  }

  getStatuses(): SiteStatus[] {
    return SITES.map((site) => this.currentStatus(site.key));
  }

  getLayout(): LayoutState {
    return {
      mode: this.renderedMode,
      automaticFocus: this.mode === "overview" && this.renderedMode === "focus",
      focused: this.focused,
      page: this.page,
      pageCount: this.pageCount,
      placements: this.placements
    };
  }

  getDisplayPreferences(): DisplayPreferences {
    return this.display;
  }

  getUiState(): DesktopUiState {
    return {
      windowBounds: this.window.getNormalBounds(),
      maximized: this.window.isMaximized(),
      layoutMode: this.mode,
      currentPage: this.page,
      focusedByPage: captureSiteFocus(this.selected, this.page, this.focused, this.focusedByPage),
      siteZoom: this.siteZoom.snapshot()
    };
  }

  getDiagnosticSites(): DiagnosticSiteInput[] {
    return diagnosticSitesForViews(SITES, this.views, this.siteSession, this.attached);
  }

  setDisplayPreferences(value: DisplayPreferences): void {
    this.display = value;
    this.layout();
  }

  setComposerExpanded(value: boolean): void {
    if (this.composerExpanded === value) return;
    this.composerExpanded = value;
    this.layout();
  }

  setDrawerOpen(value: boolean): void {
    if (this.drawerOpen === value) return;
    this.drawerOpen = value;
    this.layout();
  }

  setSelection(sites: readonly SiteKey[]): void {
    if (sites.join(",") !== this.selected.join(",")) this.focusOrder = normalizeSelection(sites);
    this.selected = normalizeSelection(sites);
    const current = resolveSitePage(this.selected, this.page);
    this.page = current.page;
    this.pageCount = current.pageCount;
    this.focused = resolveFocusedSite(current.keys, this.focused, this.focusedByPage.get(this.page));
    this.reconcileViews();
    this.clearVisibleUnread();
    this.layout();
  }

  setPage(value: number): void {
    this.focusedByPage.set(this.page, this.focused);
    const next = resolveSitePage(this.selected, value);
    if (next.page === this.page) return;
    this.page = next.page;
    this.pageCount = next.pageCount;
    this.focused = resolveFocusedSite(next.keys, this.focused, this.focusedByPage.get(this.page));
    this.reconcileViews();
    this.clearVisibleUnread();
    this.layout();
  }

  setLayout(mode: "overview" | "focus", requestedFocus: SiteKey = this.focused, activate = true): boolean {
    if (mode === "focus" && !this.selected.includes(requestedFocus)) return false;
    const selectedIndex = this.selected.indexOf(requestedFocus);
    if (selectedIndex >= 0) this.page = resolveSitePageIndex(this.selected, requestedFocus);
    const current = resolveSitePage(this.selected, this.page);
    const focused = resolveFocusedSite(current.keys, requestedFocus, this.focusedByPage.get(current.page));
    if (activate && mode === "focus" && current.keys.includes(focused)) {
      this.focusOrder = swapFocusedSite(this.focusOrder, this.focused, focused);
      this.focusedByPage.set(current.page, focused);
    }
    this.mode = mode;
    this.focused = focused;
    this.reconcileViews();
    this.clearVisibleUnread();
    this.layout();
    if (activate && mode === "focus" && current.keys.includes(focused)) {
      const view = this.views.get(focused);
      if (view && !view.webContents.isDestroyed()) view.webContents.focus();
    }
    return true;
  }

  setSurface(value: DesktopSurface): void {
    if (this.surface === value || this.window.isDestroyed()) return;
    const previous = this.surface;
    this.surface = value;
    transitionSiteSurface(previous, value, {
      detach: () => { for (const site of [...this.attached]) this.detach(site); },
      cover: covered => coverSitesForHistory(this.window, covered),
      restore: () => { this.reconcileViews(); this.clearVisibleUnread(); this.layout(); }
    });
  }

  focusRelative(offset: -1 | 1): void {
    const keys = this.selected;
    if (!keys.length) return;
    const current = keys.indexOf(this.focused);
    const next = (current + offset + keys.length) % keys.length;
    this.setLayout("focus", keys[next]);
  }

  pageRelative(offset: -1 | 1): void {
    if (this.pageCount <= 1) return;
    this.setPage((this.page + offset + this.pageCount) % this.pageCount);
  }

  pageDirect(page: number): void {
    if (!Number.isInteger(page) || page < 0 || page >= this.pageCount) return;
    this.setPage(page);
  }

  // 站内导航（点了回答里的站内链接、站点自己的跳转器）之后没有退路，此前唯一的脱身办法是
  // 「新会话」——那会丢掉当前对话。这里给出真正的后退/前进。
  navigateHistory(site: SiteKey, offset: -1 | 1): boolean {
    const view = this.views.get(site);
    if (!view || view.webContents.isDestroyed()) return false;
    // 群发/生成进行中不许动历史，理由同 reload：会把正在写的回答连同页面一起丢掉。
    if (!siteReloadAllowed(this.currentStatus(site).phase) || this.historyAccess.navigating(site)) return false;
    const history = view.webContents.navigationHistory;
    if (offset === -1 ? !history.canGoBack() : !history.canGoForward()) return false;
    this.beginNavigation(site);
    if (offset === -1) history.goBack();
    else history.goForward();
    return true;
  }

  canNavigateHistory(site: SiteKey): SiteHistoryState {
    const view = this.views.get(site);
    if (!view || view.webContents.isDestroyed()) return { back: false, forward: false };
    if (!siteReloadAllowed(this.currentStatus(site).phase) || this.historyAccess.navigating(site)) return { back: false, forward: false };
    const history = view.webContents.navigationHistory;
    return { back: history.canGoBack(), forward: history.canGoForward() };
  }

  // 一次给出全部已勾选站点的可用性：格子头部的后退按钮与 Alt+Left 共用同一份状态，
  // 避免两处各查一次而显示不一致。
  historyState(): Record<string, SiteHistoryState> {
    const state: Record<string, SiteHistoryState> = {};
    for (const site of this.selected) state[site] = this.canNavigateHistory(site);
    return state;
  }

  reload(site: SiteKey, ignoreCache = false): boolean {
    const view = this.views.get(site);
    if (!view || view.webContents.isDestroyed()) return false;
    if (!siteReloadAllowed(this.currentStatus(site).phase) || this.historyAccess.navigating(site)) return false;
    this.beginNavigation(site, view.webContents, ignoreCache);
    return true;
  }

  private beginNavigation(site: SiteKey, reloading?: WebContents, ignoreCache = false): void {
    this.historyAccess.reloads.replace(site);
    this.runStatus.delete(site);
    this.updatePageStatus({ site, phase: "loading" });
    if (reloading) this.historyAccess.reload(site, reloading, ignoreCache);
  }

  async clearSiteData(site: SiteKey): Promise<boolean> {
    return clearSiteDataAndReload(site, this.siteSession, () => this.views.get(site),
      () => siteReloadAllowed(this.currentStatus(site).phase) && !this.historyAccess.navigating(site), contents => this.beginNavigation(site, contents, true));
  }

  checkHealth(sites: readonly SiteKey[]): Promise<SiteHealth[]> {
    return Promise.all(sites.map((site) => this.checkSiteHealth(site)));
  }

  readonly historyAccess = new SiteHistoryAccess(site => this.views.get(site), this.commands, (site, abandoned) => {
    this.invalidateGeneration(site);
    this.runStatus.delete(site);
    this.updatePageStatus(abandoned === "failed" ? { site, phase: "failed", code: "load_failed" } : { site, phase: abandoned ?? "loading" });
  }, () => this.layout());
  async navigate(site: SiteKey, url: string, until: "load" | "commit" = "load"): Promise<void> { await this.historyAccess.navigate(site, url, true, until); }

  setCapturePending(check: (site: SiteKey) => boolean,
    releaseConfirmed: (site: SiteKey) => boolean = () => false,
    invalidateRelease: (sites: readonly SiteKey[]) => void = () => {}): void {
    this.capturePending = check;
    this.captureReleaseConfirmed = releaseConfirmed;
    this.invalidateCaptureRelease = invalidateRelease;
  }

  markStatus(status: SiteStatus): void {
    this.runStatus.set(status.site, statusWithUnread(preserveSubmission(this.runStatus.get(status.site), status), this.isSiteVisible(status.site)));
    this.onStatus(this.currentStatus(status.site));
    void Promise.resolve().then(() => this.releaseUnselectedViews());
  }

  private observationEnded(site: SiteKey): boolean {
    return generationEndedForRelease(this.currentStatus(site), this.generationDeadlines.get(site),
      this.generationMisses.get(site) ?? 0, this.captureReleaseConfirmed(site));
  }
  sitePageCloseReason(site: SiteKey): ReturnType<typeof sitePageCloseReason> {
    return sitePageCloseReason({ phase: protectedPagePhase(this.currentStatus(site)),
      capturePending: this.capturePending(site), navigating: this.historyAccess.navigating(site),
      observationEnded: this.observationEnded(site) });
  }

  resetRunStatus(): void {
    this.cancelGenerationRun();
    this.runStatus.clear();
    for (const site of SITES) this.onStatus(this.currentStatus(site.key));
    this.releaseUnselectedViews();
  }

  beginGenerationRun(runId: string, sites: readonly SiteKey[], submission = true): void {
    this.invalidateCaptureRelease(sites);
    const resumed = this.generation.begin(runId, sites, submission);
    if (submission) beginSubmissionRun(resumed, this.runStatus, site => this.onStatus(this.currentStatus(site)));
    for (const site of sites) this.clearGenerationTracking(site);
  }

  watchGeneration(runId: string, site: SiteKey, resumed = false): void {
    if (resumed && this.generation.reopen(runId, site)) this.clearGenerationTracking(site);
    if (!this.generation.accepts(runId, site) || this.generationDeadlines.has(site)) return;
    this.generationDeadlines.set(site, Date.now() + 45_000);
    void this.probeGeneration(runId, site);
  }

  onGenerationComplete(listener: GenerationMonitor["onComplete"]): void { this.generation.onComplete = listener; }
  invalidateGeneration(site: SiteKey): void {
    this.generation.forget(site);
    this.clearGenerationTracking(site);
  }

  cancelGenerationRun(sites?: readonly SiteKey[]): void {
    this.generation.invalidate(sites);
    if (sites) for (const site of sites) this.clearGenerationTracking(site);
    else this.clearGenerationTracking();
  }

  private clearGenerationTracking(site?: SiteKey): void {
    clearProbeTracking({ timers: this.generationTimers, deadlines: this.generationDeadlines,
      observed: this.generationObserved, misses: this.generationMisses }, site);
  }

  owns(contents: WebContents): SiteKey | null {
    for (const [key, view] of this.views) {
      if (view.webContents.id === contents.id) return key;
    }
    return null;
  }

  sendCommand(site: SiteKey, command: SubmitSiteCommand, signal: AbortSignal): Promise<SiteResult> {
    const view = this.views.get(site);
    if (!view || view.webContents.isDestroyed()) {
      return Promise.resolve({ ok: false, code: "no_view" });
    }
    // A crashed or failed page has no preload left to answer, so the request
    // would burn the whole budget and land on submit_unconfirmed — "maybe sent".
    // It was never dispatched, so report the certain failure instead. Never
    // reload and resend here: automatic resends are forbidden.
    const pageFailure = this.pageFailureCode(site);
    if (pageFailure) return Promise.resolve({ ok: false, code: pageFailure });
    const definition = SITES.find((candidate) => candidate.key === site);
    if (!definition || this.historyAccess.reloads.watching(site) || navigationDisposition(definition, view.webContents.getURL()) !== "site") {
      return Promise.resolve({ ok: false, code: "not_ready" });
    }
    return this.commands.send(view.webContents, command, {
      signal,
      timeoutResult: { ok: false, code: "submit_unconfirmed" },
      onAbort: () => {
        if (view.webContents.isDestroyed()) return;
        this.replaceView(definition, view, view.webContents.getURL() || definition.url);
      }
    }).then((result) => "ok" in result ? result : { ok: false, code: "invalid_response" });
  }

  // 只读确认，配合 BroadcastCoordinator 的 submit_unconfirmed 恢复。页面有回包才归一（fail-closed）；
  // 通道超时/取消返回 null = 这一次没人应答（页面重挂中），协调器会在窗口内再问，不能读成「不支持」。
  confirmSubmitted(site: SiteKey, command: WasSubmittedSiteCommand, signal: AbortSignal): Promise<SiteSubmittedResponse | null> {
    const view = this.views.get(site);
    if (!view || view.webContents.isDestroyed()) return Promise.resolve({ supported: false, ok: false });
    return this.commands.send(view.webContents, command, { signal, timeoutResult: { ok: false, code: "timeout" } })
      .then((result) => "supported" in result ? normalizeSubmitted(result) : null);
  }

  collect(site: SiteKey, deadline: number): Promise<SiteCollectionResult> {
    const view = this.views.get(site);
    if (!view || view.webContents.isDestroyed()) return Promise.resolve({ code: "no_view" });
    const pageFailure = this.pageFailureCode(site);
    if (pageFailure) return Promise.resolve({ code: pageFailure });
    const definition = SITES.find((candidate) => candidate.key === site);
    if (!definition || this.historyAccess.reloads.watching(site) || navigationDisposition(definition, view.webContents.getURL()) !== "site") {
      return Promise.resolve({ code: "not_ready" });
    }
    const command: CollectSiteCommand = { source: "AMS", cmd: "collect", deadline };
    return this.commands.send(view.webContents, command, {
      timeoutResult: { code: "not_ready" }
    }).then((result): SiteCollectionResult =>
      "ok" in result ? { code: "not_ready" } : result as SiteCollectionResult);
  }

  private async checkSiteHealth(site: SiteKey): Promise<SiteHealth> {
    const definition = SITES.find((candidate) => candidate.key === site);
    const view = this.views.get(site);
    const pageStatus = this.pageStatus.get(site) ?? { site, phase: "loading" as const };
    const runStatus = this.runStatus.get(site);
    const finish = (checks: unknown, navigation: ReturnType<typeof navigationDisposition>): SiteHealth => {
      const health = buildSiteHealth({ site, phase: pageStatus.phase, navigation, checks });
      const page: SiteHealthPageState = pageStatus.phase === "failed" || pageStatus.phase === "crashed"
        ? "error"
        : pageStatus.phase === "loading" || pageStatus.phase === "ready" ? pageStatus.phase : "unknown";
      const recentPhases: readonly SiteHealthRunPhase[] = ["sending", "submitted", "generating", "complete", "warning", "cancelled", "failed"];
      const recent = runStatus && recentPhases.includes(runStatus.phase as SiteHealthRunPhase)
        ? { phase: runStatus.phase as SiteHealthRunPhase, ...(runStatus.code ? { code: runStatus.code } : {}) }
        : undefined;
      return { ...health, page, checkedAt: Date.now(), ...(recent ? { recent } : {}) };
    };
    if (!definition || !view || view.webContents.isDestroyed()) {
      return finish(undefined, "block");
    }
    const navigation = navigationDisposition(definition, view.webContents.getURL());
    if (navigation !== "site" || pageStatus.phase === "loading" || ["failed", "crashed"].includes(pageStatus.phase)) {
      return finish(undefined, navigation);
    }
    const command: DiagnoseSiteCommand = {
      source: "AMS",
      cmd: "diagnose",
      deadline: Date.now() + 2_500
    };
    const response = await this.commands.send(view.webContents, command, {
      timeoutResult: { code: "not_ready" }
    });
    const checks = "checks" in response ? response.checks : undefined;
    return finish(checks, navigation);
  }

  receiveResponse(sender: WebContents, envelope: SiteResponseEnvelope): void {
    this.commands.receive(sender, envelope);
  }

  private async probeGeneration(runId: string, site: SiteKey): Promise<void> {
    const ticket = this.generation.ticket(runId, site);
    if (!ticket) return;
    const view = this.views.get(site);
    const definition = SITES.find((candidate) => candidate.key === site);
    const reachable = !!view && !view.webContents.isDestroyed() && !!definition &&
      navigationDisposition(definition, view.webContents.getURL()) === "site";
    if (!reachable || !view) {
      this.scheduleGenerationProbe(runId, site, false);
      return;
    }
    const command: GenerationSiteCommand = {
      source: "AMS",
      cmd: "generation",
      runId,
      deadline: Date.now() + 2_500
    };
    const response = await this.commands.send(view.webContents, command, {
      timeoutResult: { state: null }
    });
    if (!this.generation.holds(ticket, site)) return;
    const state = "state" in response ? parseGenerationState(response.state) : null;
    const phase = this.generation.accept(runId, site, state);
    if (!phase) return;
    // No state this round: keep polling until the miss budget runs out, so one
    // busy renderer cannot freeze the site on "submitted" for the whole run.
    if (state === null) {
      this.scheduleGenerationProbe(runId, site, false);
      return;
    }
    if (phase === "generating" && !this.generationObserved.has(site)) {
      this.generationObserved.add(site);
      this.generationDeadlines.set(site, Date.now() + 15 * 60_000);
    }
    if ((phase === "generating" || phase === "complete") && this.currentStatus(site).phase !== phase) {
      this.markStatus({ site, phase, generation: { runId, state: phase } });
    }
    // Only the settled terminal phase stops the watch — the debounce window
    // inside GenerationMonitor still reports "generating" and must keep polling.
    if (phase === "complete") return;
    this.scheduleGenerationProbe(runId, site, true);
  }

  private scheduleGenerationProbe(runId: string, site: SiteKey, observed: boolean): void {
    scheduleGenerationProbe(runId, site, observed, {
      misses: this.generationMisses, deadlines: this.generationDeadlines, timers: this.generationTimers,
      stopped: () => this.markStatus(generationObservationStatus(this.currentStatus(site))),
      probe: (run, key) => { void this.probeGeneration(run, key); }
    });
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
      onLoading: () => this.updatePageStatus({ site: site.key, phase: "loading" }),
      onReady: () => this.updatePageStatus({ site: site.key, phase: "ready" }),
      onFailure: (code) => {
        this.updatePageStatus({ site: site.key, phase: "failed", code: "load_failed" });
        this.onRuntimeEvent({ type: "did-fail-load", site: site.key, code: String(code) });
      },
      onCrash: (reason) => {
        this.updatePageStatus({ site: site.key, phase: "crashed", code: "renderer_crashed" });
        this.onRuntimeEvent({ type: "render-process-gone", site: site.key, code: reason });
      },
      onExternal: (target) => this.options.openExternal?.(target)
    });
    this.views.set(site.key, view);
    this.siteZoom.bind(site.key, view.webContents);
    // 已勾选即挂载（不再只挂当前页）：replaceView 后重建的后台视图若不回到视图树，
    // 下一轮群发又会打进 0×0 视口。层序由调用方随后的 reconcileViews 归位。
    if (this.surface === "sites" && this.selected.includes(site.key)) this.attach(site.key);
    this.updatePageStatus({ site: site.key, phase: "loading" });
    this.historyAccess.initialLoad(site.key, view.webContents, url);
  }

  private layout(): void {
    if (this.window.isDestroyed() || this.surface !== "sites" || this.window.isMinimized()) return;
    const [width, height] = this.window.getContentSize();
    // Windows maximized → minimized emits resize at 0×0; keep live page viewports intact.
    if (width <= 0 || height <= 0) return;
    const zoom = Math.max(0.25, this.window.webContents.getZoomFactor());
    const cssWidth = Math.floor(width / zoom);
    const cssHeight = Math.floor(height / zoom);
    const current = resolveSitePage(this.selected, this.page);
    this.page = current.page;
    this.pageCount = current.pageCount;
    const next = computeWorkspaceLayout({
      width: cssWidth - historyPanelWidth(cssWidth, this.historyAccess.panelOpen),
      height: cssHeight,
      density: this.display.density,
      composerExpanded: this.composerExpanded,
      drawerOpen: this.drawerOpen,
      requestedMode: this.mode,
      focused: this.focused,
      overviewOrder: current.keys,
      focusOrder: this.focusOrder.filter((site) => current.keys.includes(site))
    });
    this.renderedMode = next.mode;
    this.placements = next.placements;
    const metrics = next.metrics;
    // this.placements 只含当前页——渲染层的 tile 表头靠它，绝不能混进后台视图。
    // 但后台视图也必须落格：视图树里尺寸为 0 的视图，页面 innerWidth/innerHeight 就是 0。
    // 用与当前页第一格**完全相同**的矩形（而不是窗口外偏移——移出边界是否触发遮挡剔除未实测），
    // 配合 reconcileViews 的层序，它们被第一格完全盖住，不漏出也不抢事件。
    const cover = next.placements[0];
    const background = cover
      ? this.selected
        .filter((site) => !current.keys.includes(site))
        .map((key) => ({ key, bounds: cover.bounds }))
      : [];
    applyWorkspaceLayout({
      views: this.views,
      placements: [...background, ...this.placements],
      metrics,
      zoom,
      display: this.display,
      siteZoom: this.siteZoom,
      mode: this.renderedMode,
      focused: this.focused
    });
    const layout = this.getLayout();
    this.onLayout(layout);
    this.options.onUiStateChange?.(this.getUiState());
  }

  private currentStatus(site: SiteKey): SiteStatus {
    const pageStatus = this.pageStatus.get(site) ?? { site, phase: "loading" as const };
    return effectiveStatus(this.runStatus.get(site), pageStatus);
  }

  private pageFailureCode(site: SiteKey): "renderer_crashed" | "load_failed" | null {
    const phase = this.pageStatus.get(site)?.phase;
    if (phase === "crashed") return "renderer_crashed";
    if (phase === "failed") return "load_failed";
    return null;
  }

  private updatePageStatus(status: SiteStatus): void {
    this.pageStatus.set(status.site, statusWithUnread(status, this.isSiteVisible(status.site)));
    this.onStatus(this.currentStatus(status.site));
  }

  private clearVisibleUnread(): void {
    // Mirror isSiteVisible: paging or reselecting while the archive, settings or
    // command surface is up must not mark hidden site badges as read.
    if (this.surface !== "sites") return;
    for (const site of this.visibleSites()) {
      for (const statuses of [this.pageStatus, this.runStatus]) {
        const status = statuses.get(site);
        if (status?.unread) statuses.set(site, markStatusRead(status));
      }
      this.onStatus(this.currentStatus(site));
    }
  }

  private isSiteVisible(site: SiteKey): boolean {
    return this.surface === "sites" && this.visibleSites().includes(site);
  }

  private visibleSites(): readonly SiteKey[] {
    return resolveSitePage(this.selected, this.page).keys;
  }

  // 挂载的是**全部已勾选站点**（不只当前页）：未挂进视图树的 WebContentsView 视口恒 0×0，
  // findComposer 恒 null，群发对后台页站点必然 composer_not_found（理由与实测见 view-visibility.ts）。
  // 顺序由 stackOrder 决定，后加的盖在上面，所以当前页永远压住后台页。
  // 只为**已勾选**站点建视图。此前无论勾几个站都会把九个站点全部建出来并加载完整 SPA，
  // 于是「少勾站点」根本不省内存——按真机实测单站平均约 250MB 工作集，只用 5 个站的人白付约 1GB。

  // 明确关页才释放资源，登录保留在持久化 session；发送、生成和答案采集结束前不关闭。
  // 状态更新及采集落库后都会重查，不再等待下一次用户布局操作。
  releaseUnselectedViews(): void {
    if (this.window.isDestroyed()) return;
    reclaimUnselectedViews({
      views: this.views, selected: this.selected, status: site => ({ ...this.currentStatus(site), phase: protectedPagePhase(this.currentStatus(site)) }),
      capturePending: this.capturePending, detach: site => this.detach(site),
      observationEnded: site => this.observationEnded(site), navigating: site => this.historyAccess.navigating(site),
      pageStatus: this.pageStatus, runStatus: this.runStatus,
      forget: site => { this.generation.forget(site); this.clearGenerationTracking(site); }
    });
  }

  private reconcileViews(): void {
    if (this.surface !== "sites" || this.window.isDestroyed()) return;
    ensureSiteViews(this.selected, this.views, definition => this.createView(definition));
    this.releaseUnselectedViews();
    for (const site of stackOrder([...this.views.keys()], this.visibleSites())) {
      this.attach(site); // 未选但忙碌的页保留正视口，仅隐藏；当前页仍排在最上层。
      this.views.get(site)!.setVisible(this.selected.includes(site));
    }
  }

  private attach(site: SiteKey): void {
    const view = this.views.get(site);
    if (!view) return;
    // 对**已在视图树里**的子视图，addChildView 是「原地提升到最顶层」而不是重复插入
    // （Electron 43.4.0 实测：幂等、children 不增长）——当前页正是靠重挂来盖住后台页，
    // 所以这里不做 has() 短路。**绝不要改成先 detach 再 attach**：全拆重挂会让被聚焦站点的
    // 渲染进程真的丢焦点并触发 blur（实测），而重挂本身不会。
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
    this.cancelGenerationRun();
    this.commands.dispose();
    for (const view of this.views.values()) {
      if (!view.webContents.isDestroyed()) view.webContents.close();
    }
    this.attached.clear();
    this.views.clear();
  }
}
