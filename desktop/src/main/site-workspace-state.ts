import type { LayoutMode, SiteKey, ViewPlacement } from "../shared/contracts";
import { captureSiteFocus, type DesktopUiState } from "../shared/desktop-ui-state";
import {
  DEFAULT_DISPLAY_PREFERENCES,
  type DisplayMetrics,
  type DisplayPreferences
} from "../shared/display";
import type { DesktopSurface, LayoutState } from "../shared/protocol";
import {
  resolveFocusedSite,
  resolveSitePage,
  resolveSitePageIndex
} from "../shared/site-pages";
import { normalizeSelection } from "../shared/workspace";
import { resolveDuelSites, swapFocusedSite } from "./layout";
import { SITES } from "./sites";
import { computeWorkspaceLayout } from "./workspace-layout";
import { workspaceViewport } from "./workspace-viewport";

export interface SiteWorkspaceStateOptions {
  readonly initialUiState?: DesktopUiState;
  readonly selectedSites?: readonly SiteKey[];
}

export interface ComputedWorkspacePlacements {
  readonly placementsWithBackground: readonly ViewPlacement[];
  readonly currentPlacements: readonly ViewPlacement[];
  readonly metrics: DisplayMetrics;
  readonly zoom: number;
  readonly renderedMode: LayoutMode;
  readonly focused: SiteKey;
  readonly display: DisplayPreferences;
}

export class SiteWorkspaceState {
  mode: LayoutMode = "overview";
  renderedMode: LayoutMode = "overview";
  focused: SiteKey = "claude";
  selected: SiteKey[];
  page = 0;
  pageCount = 3;
  readonly focusedByPage: Map<number, SiteKey>;
  focusOrder: SiteKey[];
  placements: readonly ViewPlacement[] = [];
  display: DisplayPreferences = DEFAULT_DISPLAY_PREFERENCES;
  composerExpanded = false;
  drawerOpen = false;
  surface: DesktopSurface = "sites";

  constructor(options: SiteWorkspaceStateOptions = {}) {
    this.selected = normalizeSelection(options.selectedSites ?? SITES.map((site) => site.key));
    this.focusOrder = [...this.selected];
    this.focused = this.selected[0] ?? this.focused;
    const initial = options.initialUiState;
    this.focusedByPage = new Map(
      Object.entries(initial?.focusedByPage ?? {}).map(([page, site]) => [Number(page), site])
    );
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
  }

  getLayout(): LayoutState {
    return {
      mode: this.renderedMode,
      automaticFocus: this.mode !== "focus" && this.renderedMode === "focus",
      focused: this.focused,
      page: this.page,
      pageCount: this.pageCount,
      placements: this.placements
    };
  }

  captureUiState(
    windowBounds: DesktopUiState["windowBounds"],
    maximized: boolean,
    siteZoom: DesktopUiState["siteZoom"]
  ): DesktopUiState {
    return {
      windowBounds,
      maximized,
      layoutMode: this.mode,
      currentPage: this.page,
      focusedByPage: captureSiteFocus(this.selected, this.page, this.focused, this.focusedByPage),
      siteZoom
    };
  }

  setComposerExpanded(value: boolean): boolean {
    if (this.composerExpanded === value) return false;
    this.composerExpanded = value;
    return true;
  }

  setDrawerOpen(value: boolean): boolean {
    if (this.drawerOpen === value) return false;
    this.drawerOpen = value;
    return true;
  }

  resetOverlays(): void {
    this.composerExpanded = false;
    this.drawerOpen = false;
  }

  isConfirmationActive(): boolean {
    return this.surface === "confirmation";
  }

  setSelection(sites: readonly SiteKey[]): void {
    if (sites.join(",") !== this.selected.join(",")) this.focusOrder = normalizeSelection(sites);
    this.selected = normalizeSelection(sites);
    const current = resolveSitePage(this.selected, this.page);
    this.page = current.page;
    this.pageCount = current.pageCount;
    this.focused = resolveFocusedSite(current.keys, this.focused, this.focusedByPage.get(this.page));
  }

  setPage(value: number): boolean {
    if (this.isConfirmationActive()) return false;
    this.focusedByPage.set(this.page, this.focused);
    const next = resolveSitePage(this.selected, value);
    if (next.page === this.page) return false;
    this.page = next.page;
    this.pageCount = next.pageCount;
    this.focused = resolveFocusedSite(next.keys, this.focused, this.focusedByPage.get(this.page));
    return true;
  }

  applyLayout(
    mode: LayoutMode,
    requestedFocus: SiteKey = this.focused,
    activate = true
  ): { accepted: boolean; shouldFocusSite: boolean } {
    if (mode !== "overview" && !this.selected.includes(requestedFocus)) {
      return { accepted: false, shouldFocusSite: false };
    }
    const selectedIndex = this.selected.indexOf(requestedFocus);
    if (selectedIndex >= 0) this.page = resolveSitePageIndex(this.selected, requestedFocus);
    const current = resolveSitePage(this.selected, this.page);
    const focused = resolveFocusedSite(current.keys, requestedFocus, this.focusedByPage.get(current.page));
    if (activate && mode !== "overview" && current.keys.includes(focused)) {
      this.focusOrder = swapFocusedSite(this.focusOrder, this.focused, focused);
      this.focusedByPage.set(current.page, focused);
    }
    this.mode = mode;
    this.focused = focused;
    const shouldFocusSite = activate && this.surface === "sites" && mode !== "overview" && current.keys.includes(focused);
    return { accepted: true, shouldFocusSite };
  }

  relativeFocusTarget(offset: -1 | 1): { mode: LayoutMode; target: SiteKey } | null {
    if (this.isConfirmationActive()) return null;
    const keys = this.selected;
    if (!keys.length) return null;
    const current = keys.indexOf(this.focused);
    const next = (current + offset + keys.length) % keys.length;
    return { mode: this.mode === "duel" ? "duel" : "focus", target: keys[next] };
  }

  relativePageTarget(offset: -1 | 1): number | null {
    if (this.pageCount <= 1) return null;
    return (this.page + offset + this.pageCount) % this.pageCount;
  }

  canPageDirect(page: number): boolean {
    return Number.isInteger(page) && page >= 0 && page < this.pageCount;
  }

  visibleSites(): readonly SiteKey[] {
    const keys = resolveSitePage(this.selected, this.page).keys;
    return this.mode === "duel" && this.renderedMode !== "focus"
      ? resolveDuelSites(this.focusOrder.filter((site) => keys.includes(site)), this.focused)
      : keys;
  }

  isSiteVisible(site: SiteKey): boolean {
    return this.surface === "sites" && this.visibleSites().includes(site);
  }

  computeViewportPlacements(
    contentSize: [number, number],
    shellZoomFactor: number,
    historyPanelOpen: boolean,
    findOpen: boolean
  ): ComputedWorkspacePlacements | null {
    const [width, height] = contentSize;
    // Windows maximized → minimized emits resize at 0×0; keep live page viewports intact.
    if (width <= 0 || height <= 0) return null;
    const viewport = workspaceViewport([width, height], shellZoomFactor, historyPanelOpen);
    const current = resolveSitePage(this.selected, this.page);
    this.page = current.page;
    this.pageCount = current.pageCount;
    const next = computeWorkspaceLayout({
      width: viewport.width,
      height: viewport.height,
      toolbarWidth: viewport.shellWidth,
      density: this.display.density,
      composerExpanded: this.composerExpanded,
      findOpen,
      drawerOpen: this.drawerOpen,
      requestedMode: this.mode,
      focused: this.focused,
      overviewOrder: current.keys,
      focusOrder: this.focusOrder.filter((site) => current.keys.includes(site))
    });
    this.renderedMode = next.mode;
    this.placements = next.placements;
    // this.placements 只含当前页——渲染层的 tile 表头靠它，绝不能混进后台视图。
    // 但后台视图也必须落格：视图树里尺寸为 0 的视图，页面 innerWidth/innerHeight 就是 0。
    // 用与当前页第一格**完全相同**的矩形（而不是窗口外偏移——移出边界是否触发遮挡剔除未实测），
    // 配合 reconcileViews 的层序，它们被第一格完全盖住，不漏出也不抢事件。
    const placed = new Set(this.placements.map((item) => item.key));
    const cover = next.placements[0];
    const background = cover
      ? this.selected.filter((site) => !placed.has(site)).map((key) => ({ key, bounds: cover.bounds }))
      : [];
    return {
      placementsWithBackground: [...this.placements, ...background],
      currentPlacements: this.placements,
      metrics: next.metrics,
      zoom: viewport.zoom,
      renderedMode: this.renderedMode,
      focused: this.focused,
      display: this.display
    };
  }
}
