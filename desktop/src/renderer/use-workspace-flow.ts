import { useMemo, useRef, useState } from "react";

import type { SiteDefinition, SiteKey } from "../shared/contracts";
import type { Tier } from "../shared/protocol";
import type { WorkspaceState } from "../shared/workspace";
import { compareSyncVersion } from '../shared/sync';
import { shell } from "./shell-api";

const INITIAL_WORKSPACE: WorkspaceState = { selectedSites: [], groups: [], tier: null };

export function useWorkspaceFlow(
  sites: readonly SiteDefinition[],
  failedMessage: string,
  announce: (value: string) => void
) {
  const selectionRef = useRef<readonly SiteKey[]>([]);
  const selectionRequest = useRef(0);
  const pendingSelection = useRef<readonly SiteKey[] | null>(null);
  const participationRequest = useRef(0);
  const pendingParticipation = useRef<readonly SiteKey[] | null>(null);
  const acceptedWorkspace = useRef<WorkspaceState>(INITIAL_WORKSPACE);
  const [workspace, setWorkspace] = useState<WorkspaceState>(INITIAL_WORKSPACE);
  const accept = (value: WorkspaceState): void => {
    const latest = acceptedWorkspace.current;
    if (compareSyncVersion(latest.participationVersion ?? {}, value.participationVersion ?? {}) > 0) value = latest;
    acceptedWorkspace.current = value;
    const selectedSites = pendingSelection.current ?? value.selectedSites;
    selectionRef.current = selectedSites;
    setWorkspace({ ...value, selectedSites,
      ...(pendingParticipation.current ? { participatingSites: pendingParticipation.current } : {}) });
  };
  const recover = (): void => {
    pendingSelection.current = null;
    accept(acceptedWorkspace.current);
    const request = ++selectionRequest.current;
    announce(failedMessage);
    void shell.bootstrap().then((state) => {
      if (request === selectionRequest.current) accept(state.workspace);
    }).catch(() => undefined);
  };
  const openPages = async (value: readonly SiteKey[]): Promise<readonly SiteKey[]> => {
    const ordered = [...new Set(value)].filter((key) => sites.some((site) => site.key === key));
    const request = ++selectionRequest.current;
    pendingSelection.current = ordered;
    selectionRef.current = ordered;
    setWorkspace((current) => ({ ...current, selectedSites: ordered }));
    try {
      const state = await shell.setSelection(ordered);
      if (request !== selectionRequest.current) return selectionRef.current;
      pendingSelection.current = null;
      accept(state);
      return selectionRef.current;
    } catch (error) {
      if (request === selectionRequest.current) recover();
      throw error;
    }
  };
  // Existing callers intentionally do not await deferred IPC acknowledgements.
  const changeSelection = (value: readonly SiteKey[]): void => { void openPages(value).catch(() => undefined); };
  const selected = useMemo(() => new Set(workspace.selectedSites), [workspace.selectedSites]);
  return {
    workspace,
    selected,
    currentSelection: () => selectionRef.current,
    accept,
    invalidate: () => {
      selectionRequest.current++; pendingSelection.current = null;
      participationRequest.current++; pendingParticipation.current = null;
      acceptedWorkspace.current = INITIAL_WORKSPACE;
    },
    changeSelection,
    openPages,
    saveParticipation: async (sites: readonly SiteKey[]): Promise<readonly SiteKey[]> => {
      const request = ++participationRequest.current;
      pendingParticipation.current = sites;
      try {
        const state = await shell.setParticipation(sites);
        if (request !== participationRequest.current) throw new Error('operation_superseded');
        pendingParticipation.current = null; accept(state);
        return acceptedWorkspace.current.participatingSites ?? acceptedWorkspace.current.selectedSites;
      } catch (error) {
        if (request === participationRequest.current) { pendingParticipation.current = null; recover(); }
        throw error;
      }
    },
    toggleSite: (site: SiteKey) => {
      const next = new Set(selectionRef.current);
      if (next.has(site)) next.delete(site); else next.add(site);
      changeSelection([...next]);
    },
    changeTier: (tier: Tier) => {
      setWorkspace((current) => ({ ...current, tier }));
      void shell.setTier(tier).then(accept).catch(recover);
    },
    saveGroup: async (name: string, participating: readonly SiteKey[] = selectionRef.current): Promise<boolean> => {
      try {
        accept(await shell.saveGroup({ name, sites: [...participating] }));
        return true;
      } catch {
        recover();
        return false;
      }
    },
    deleteGroup: (id: string) => {
      void shell.deleteGroup(id).then(accept).catch(recover);
    },
    recover
  };
}
