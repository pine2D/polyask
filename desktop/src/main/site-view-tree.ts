import type { BrowserWindow, Session, WebContents, WebContentsView } from "electron";

import type { LayoutMode, SiteDefinition, SiteKey } from "../shared/contracts";
import type { DesktopUiState } from "../shared/desktop-ui-state";
import type { LayoutState } from "../shared/protocol";
import type { DiagnosticSiteInput } from "./diagnostics";
import { ensureSiteViews } from "./ensure-site-views";
import type { SiteFindController } from "./site-find";
import { bindSiteFocus } from "./site-focus";
import type { SiteHistoryAccess } from "./site-history-access";
import type { SiteStatusRegistry } from "./site-status-registry";
import type { createSiteView, diagnosticSitesForViews, SiteWebRtcPolicy } from "./site-view";
import type { SiteWorkspaceState } from "./site-workspace-state";
import type { SiteZoomController } from "./site-zoom";
import { SITES } from "./sites";
import type { StabilityEventInput } from "./stability-monitor";
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

export interface SiteViewTreeDeps {
  readonly window: BrowserWindow;
  readonly siteSession: Session;
  readonly workspace: SiteWorkspaceState;
  readonly statuses: SiteStatusRegistry;
  readonly siteZoom: SiteZoomController;
  readonly siteFind: SiteFindController;
  readonly getHistoryAccess: () => SiteHistoryAccess;
  readonly createSiteView: typeof createSiteView;
  readonly diagnosticSitesForViews: typeof diagnosticSitesForViews;
  readonly releaseUnselectedViews: () => void;
  readonly setLayout: (mode: LayoutMode, requestedFocus?: SiteKey, activate?: boolean) => boolean;
  readonly onLayout: (layout: LayoutState) => void;
  readonly onRuntimeEvent: (event: StabilityEventInput) => void;
  readonly getUiState: () => DesktopUiState;
  readonly onUiStateChange?: (state: DesktopUiState) => void;
  readonly openExternal?: (url: string) => void;
  readonly webrtcPolicy: () => SiteWebRtcPolicy;
}

export class SiteViewTree {
  readonly views = new Map<SiteKey, WebContentsView>();
  readonly attached = new Set<SiteKey>();

  constructor(private readonly deps: SiteViewTreeDeps) {}

  initialize(): void {
    this.deps.siteSession.setPermissionCheckHandler(
      (_contents, permission) => SITE_PERMISSION_ALLOWLIST.has(permission)
    );
    this.deps.siteSession.setPermissionRequestHandler((_contents, permission, callback) =>
      callback(SITE_PERMISSION_ALLOWLIST.has(permission)));
    ensureSiteViews(this.deps.workspace.selected, this.views, (definition) => this.createView(definition));
    this.reconcileViews();
    this.layout();
  }

  getDiagnosticSites(): DiagnosticSiteInput[] {
    return this.deps.diagnosticSitesForViews(SITES, this.views, this.deps.siteSession, this.attached);
  }

  owns(contents: WebContents): SiteKey | null {
    for (const [key, view] of this.views) {
      if (view.webContents.id === contents.id) return key;
    }
    return null;
  }

  focusCurrentSite(): void {
    const historyAccess = this.deps.getHistoryAccess();
    if (this.deps.window.isDestroyed() || this.deps.workspace.surface !== "sites" || historyAccess.panelOpen) return;
    if (!this.deps.workspace.selected.includes(this.deps.workspace.focused)) return;
    const contents = this.views.get(this.deps.workspace.focused)?.webContents;
    if (contents && !contents.isDestroyed()) contents.focus();
  }

  replaceView(site: SiteDefinition, view: WebContentsView, url: string): void {
    if (this.views.get(site.key) !== view || this.deps.window.isDestroyed()) return;
    this.detach(site.key);
    this.views.delete(site.key);
    if (!view.webContents.isDestroyed()) view.webContents.close();
    this.createView(site, url);
    this.reconcileViews();
    this.layout();
  }

  createView(site: SiteDefinition, url: string = site.url): void {
    const view = this.deps.createSiteView(site, {
      ...this.deps.statuses.pageLifecycleCallbacks(site.key, this.deps.onRuntimeEvent),
      onExternal: (target) => this.deps.openExternal?.(target),
      webrtcPolicy: this.deps.webrtcPolicy
    });
    this.views.set(site.key, view);
    this.deps.siteZoom.bind(site.key, view.webContents);
    bindSiteFocus(
      view.webContents,
      site.key,
      () => this.deps.workspace.getLayout(),
      () => this.deps.workspace.surface === "sites" && !this.deps.getHistoryAccess().panelOpen,
      (key) => this.deps.setLayout(this.deps.workspace.mode, key, false)
    );
    // 已勾选即挂载（不再只挂当前页）：replaceView 后重建的后台视图若不回到视图树，
    // 下一轮群发又会打进 0×0 视口。层序由调用方随后的 reconcileViews 归位。
    if (this.deps.workspace.surface === "sites" && this.deps.workspace.selected.includes(site.key)) {
      this.attach(site.key);
    }
    this.deps.statuses.updatePage({ site: site.key, phase: "loading" });
    this.deps.getHistoryAccess().initialLoad(site.key, view.webContents, url);
  }

  layout(): void {
    if (this.deps.window.isDestroyed() || this.deps.workspace.surface !== "sites" || this.deps.window.isMinimized()) {
      return;
    }
    const computed = this.deps.workspace.computeViewportPlacements(
      this.deps.window.getContentSize() as [number, number],
      this.deps.window.webContents.getZoomFactor(),
      this.deps.getHistoryAccess().panelOpen,
      this.deps.siteFind.state.open
    );
    if (!computed) return;
    for (const item of computed.currentPlacements) this.attach(item.key);
    applyWorkspaceLayout({
      views: this.views,
      placements: computed.placementsWithBackground,
      metrics: computed.metrics,
      zoom: computed.zoom,
      display: computed.display,
      siteZoom: this.deps.siteZoom,
      mode: computed.renderedMode,
      focused: computed.focused
    }, this.deps.siteFind.state.open);
    this.deps.onLayout(this.deps.workspace.getLayout());
    this.deps.siteFind.sync();
    this.deps.onUiStateChange?.(this.deps.getUiState());
  }

  // 挂载的是**全部已勾选站点**（不只当前页）：未挂进视图树的 WebContentsView 视口恒 0×0，
  // findComposer 恒 null，群发对后台页站点必然 composer_not_found（理由与实测见 view-visibility.ts）。
  // 顺序由 stackOrder 决定，后加的盖在上面，所以当前页永远压住后台页。
  // 只为**已勾选**站点建视图。此前无论勾几个站都会把九个站点全部建出来并加载完整 SPA，
  // 于是「少勾站点」根本不省内存——按真机实测单站平均约 250MB 工作集，只用 5 个站的人白付约 1GB。
  reconcileViews(): void {
    if (this.deps.workspace.surface !== "sites" || this.deps.window.isDestroyed()) return;
    ensureSiteViews(this.deps.workspace.selected, this.views, (definition) => this.createView(definition));
    this.deps.releaseUnselectedViews();
    for (const site of stackOrder([...this.views.keys()], this.deps.workspace.visibleSites())) {
      this.attach(site); // 未选但忙碌的页保留正视口，仅隐藏；当前页仍排在最上层。
      this.views.get(site)!.setVisible(this.deps.workspace.selected.includes(site));
    }
  }

  attach(site: SiteKey): void {
    const view = this.views.get(site);
    if (!view) return;
    // 对**已在视图树里**的子视图，addChildView 是「原地提升到最顶层」而不是重复插入
    // （Electron 43.4.0 实测：幂等、children 不增长）——当前页正是靠重挂来盖住后台页，
    // 所以这里不做 has() 短路。**绝不要改成先 detach 再 attach**：全拆重挂会让被聚焦站点的
    // 渲染进程真的丢焦点并触发 blur（实测），而重挂本身不会。
    this.deps.window.contentView.addChildView(view);
    this.attached.add(site);
  }

  detach(site: SiteKey): void {
    const view = this.views.get(site);
    if (!view || !this.attached.has(site)) return;
    this.deps.window.contentView.removeChildView(view);
    this.attached.delete(site);
  }

  detachAll(): void {
    for (const site of [...this.attached]) this.detach(site);
  }

  dispose(): void {
    for (const view of this.views.values()) {
      if (!view.webContents.isDestroyed()) view.webContents.close();
    }
    this.attached.clear();
    this.views.clear();
  }
}
