import { useSiteParticipation } from './use-site-participation';
import type { useWorkspaceFlow } from './use-workspace-flow';
import type { ExclusiveActionLock } from './broadcast-flow-state';

export function useSyncedSiteParticipation(flow: ReturnType<typeof useWorkspaceFlow>, ready: boolean,
  lock: ExclusiveActionLock, onError: () => void) {
  return useSiteParticipation({ opened: flow.workspace.selectedSites, saved: flow.workspace.participatingSites,
    ready, get busy() { return lock.busy; }, onError,
    openPages: async next => {
      const accepted = await lock.run(() => flow.openPages(next));
      if (!accepted) throw new Error('operation_busy');
      return accepted;
    },
    save: async next => {
      const accepted = await lock.run(() => flow.saveParticipation(next));
      if (!accepted) throw new Error('operation_busy');
      return accepted;
    }
  });
}
