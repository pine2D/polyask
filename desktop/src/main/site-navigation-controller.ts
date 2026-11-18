import type { Session, WebContents, WebContentsView } from "electron";

import type { SiteKey } from "../shared/contracts";
import type { SiteNavigationHistoryState } from "../shared/protocol";
import { siteReloadAllowed } from "../shared/site-health";
import type { SiteCommandChannel } from "./site-command-channel";
import { clearSiteDataAndReload } from "./site-data-recovery";
import { SiteHistoryAccess } from "./site-history-access";
import { navigateSiteHistory, siteHistoryState } from "./site-history-navigation";
import type { SiteStatusRegistry } from "./site-status-registry";

export interface SiteNavigationControllerDeps {
  readonly siteSession: Session;
  readonly getView: (site: SiteKey) => WebContentsView | undefined;
  readonly commands: SiteCommandChannel;
  readonly statuses: SiteStatusRegistry;
  readonly invalidateGeneration: (site: SiteKey) => void;
  readonly generationAttempt: (site: SiteKey) => unknown;
  readonly relayout: () => void;
}

export class SiteNavigationController {
  readonly historyAccess: SiteHistoryAccess;

  constructor(private readonly deps: SiteNavigationControllerDeps) {
    this.historyAccess = new SiteHistoryAccess(
      deps.getView,
      deps.commands,
      (site, abandoned) => {
        deps.invalidateGeneration(site);
        deps.statuses.abandonNavigation(site, abandoned);
      },
      deps.relayout
    );
  }

  // 站内导航（点了回答里的站内链接、站点自己的跳转器）之后没有退路，此前唯一的脱身办法是
  // 「新会话」——那会丢掉当前对话。这里给出真正的后退/前进。
  navigateHistory(site: SiteKey, offset: -1 | 1, confirmationActive: boolean): boolean {
    if (confirmationActive) return false;
    const page = this.deps.statuses.pageStatus.get(site);
    return navigateSiteHistory(this.deps.getView(site), this.canNavigateHistory(site), offset, {
      begin: (contents, target) => {
        this.beginNavigation(site);
        this.historyAccess.reloads.replace(site, contents, target);
      },
      sameDocument: () => {
        this.historyAccess.reloads.replace(site);
        if (page) this.deps.statuses.updatePage(page);
      }
    });
  }

  canNavigateHistory(site: SiteKey): SiteNavigationHistoryState {
    return siteHistoryState(
      this.deps.getView(site),
      this.deps.statuses.current(site).phase,
      this.historyAccess.navigating(site)
    );
  }

  // 一次给出全部已勾选站点的可用性：格子头部的后退按钮与 Alt+Left 共用同一份状态，
  // 避免两处各查一次而显示不一致。
  historyState(selectedSites: readonly SiteKey[]): Record<string, SiteNavigationHistoryState> {
    const state: Record<string, SiteNavigationHistoryState> = {};
    for (const site of selectedSites) state[site] = this.canNavigateHistory(site);
    return state;
  }

  reload(site: SiteKey, ignoreCache = false): boolean {
    const view = this.deps.getView(site);
    if (!view || view.webContents.isDestroyed()) return false;
    if (!siteReloadAllowed(this.deps.statuses.current(site).phase) || this.historyAccess.navigating(site)) {
      return false;
    }
    this.beginNavigation(site, view.webContents, ignoreCache);
    return true;
  }

  beginNavigation(site: SiteKey, reloading?: WebContents, ignoreCache = false): void {
    this.historyAccess.reloads.replace(site);
    this.deps.statuses.beginNavigation(site);
    if (reloading) this.historyAccess.reload(site, reloading, ignoreCache);
  }

  clearSiteData(site: SiteKey): Promise<boolean> {
    return clearSiteDataAndReload(
      site,
      this.deps.siteSession,
      () => this.deps.getView(site),
      () => this.deps.generationAttempt(site),
      () => siteReloadAllowed(this.deps.statuses.current(site).phase) && !this.historyAccess.navigating(site),
      (contents) => this.beginNavigation(site, contents, true)
    );
  }

  async navigate(site: SiteKey, url: string, until: "load" | "commit" = "load"): Promise<void> {
    await this.historyAccess.navigate(site, url, true, until);
  }
}
