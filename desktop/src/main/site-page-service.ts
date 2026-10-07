import type { SiteKey } from '../shared/contracts';
import { sitePageCloseRequest, sitePageKey, type SitePageClosePreview, type SitePageCloseReason,
  type SitePageCloseResult } from '../shared/site-page';
import type { WorkspaceState } from '../shared/workspace';

export interface SitePageCloseDependencies {
  readonly identity: (site: SiteKey) => number | null;
  readonly closeReason: (site: SiteKey) => SitePageCloseReason | null;
  readonly release: () => void;
  readonly workspace: {
    getState(): WorkspaceState;
    setSelection(sites: readonly SiteKey[]): WorkspaceState;
  };
  readonly gate: { run<T>(action: () => Promise<T>): Promise<T> };
  readonly publish: () => WorkspaceState;
}

export class SitePageService {
  constructor(private readonly dependencies: SitePageCloseDependencies) {}

  preview(value: unknown): SitePageClosePreview {
    const site = sitePageKey(value);
    if (!site) throw new Error('invalid_site');
    const opened = this.dependencies.workspace.getState().selectedSites.includes(site);
    return { site, contentsId: opened ? this.dependencies.identity(site) : null,
      reason: opened ? this.dependencies.closeReason(site) : null };
  }

  async close(value: unknown): Promise<SitePageCloseResult> {
    const request = sitePageCloseRequest(value);
    if (!request) throw new Error('invalid_site_page_close');
    try {
      return await this.dependencies.gate.run(async (): Promise<SitePageCloseResult> => {
        const state = this.dependencies.workspace.getState();
        if (!state.selectedSites.includes(request.site)) return { state: 'not_open', workspace: state };
        if (this.dependencies.identity(request.site) !== request.contentsId) return { state: 'blocked', reason: 'page_changed' };
        const reason = this.dependencies.closeReason(request.site);
        if (reason) return { state: 'blocked', reason };
        // No await between identity/protection checks and persistent removal.
        this.dependencies.workspace.setSelection(state.selectedSites.filter(site => site !== request.site));
        const workspace = this.dependencies.publish();
        // Confirmation retains the tree; setSelection alone does not sweep it.
        this.dependencies.release();
        return { state: 'closed', workspace };
      });
    } catch (error) {
      if (error instanceof Error && error.message === 'operation_busy') return { state: 'blocked', reason: 'operation_busy' };
      throw error;
    }
  }
}
