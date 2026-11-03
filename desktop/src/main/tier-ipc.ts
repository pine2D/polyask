import type { IpcMain, IpcMainInvokeEvent } from 'electron';
import type { OperationGate } from '../shared/operation-gate';
import type { SiteKey } from '../shared/contracts';
import type { SiteResult, Tier } from '../shared/protocol';
import type { TierChangeResult } from '../shared/tier-switch';
import type { WorkspaceState } from '../shared/workspace';
import type { WorkspaceService } from './workspace-service';

interface TierIpcOptions {
  readonly ipc: Pick<IpcMain, 'handle' | 'removeHandler'>;
  readonly workspace: WorkspaceService;
  readonly gate: OperationGate;
  readonly trusted: (event: IpcMainInvokeEvent) => boolean;
  readonly blocked: () => boolean;
  readonly publish: () => WorkspaceState;
  readonly switchTier: (site: SiteKey, tier: Exclude<Tier, null>, deadline: number) => Promise<SiteResult>;
}

export function registerTierIpc(options: TierIpcOptions): () => void {
  const { ipc, workspace, gate } = options;
  ipc.handle('polyask:apply-tier', async (event, value: unknown): Promise<TierChangeResult> => {
    if (!options.trusted(event)) throw new Error('untrusted_sender');
    if (value !== null && value !== 'think' && value !== 'fast') throw new Error('invalid_tier');
    if (options.blocked()) throw new Error('operation_busy');
    return gate.run(async () => {
      const state = workspace.setTier(value);
      options.publish();
      const sites = state.selectedSites.filter(site => (state.participatingSites ?? state.selectedSites).includes(site));
      const deadline = Date.now() + 10_000;
      const results = value === null ? [] : await Promise.all(sites.map(async site => {
        try { return { ...await options.switchTier(site, value, deadline), site }; }
        catch { return { site, ok: false, code: 'error' }; }
      }));
      return { workspace: workspace.getState(), results };
    });
  });
  return () => ipc.removeHandler('polyask:apply-tier');
}
