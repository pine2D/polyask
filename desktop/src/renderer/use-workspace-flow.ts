import { useMemo, useRef, useState } from "react";

import type { SiteDefinition, SiteKey } from "../shared/contracts";
import type { Tier } from "../shared/protocol";
import type { WorkspaceState } from "../shared/workspace";
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
  const [workspace, setWorkspace] = useState<WorkspaceState>(INITIAL_WORKSPACE);
  const accept = (value: WorkspaceState): void => {
    const selectedSites = pendingSelection.current ?? value.selectedSites;
    selectionRef.current = selectedSites;
    setWorkspace({ ...value, selectedSites });
  };
  const recover = (): void => {
    pendingSelection.current = null;
    const request = ++selectionRequest.current;
    announce(failedMessage);
    void shell.bootstrap().then((state) => {
      if (request === selectionRequest.current) accept(state.workspace);
    }).catch(() => undefined);
  };
  const changeSelection = (value: readonly SiteKey[]): void => {
    const ordered = [...new Set(value)].filter((key) => sites.some((site) => site.key === key));
    const request = ++selectionRequest.current;
    pendingSelection.current = ordered;
    selectionRef.current = ordered;
    setWorkspace((current) => ({ ...current, selectedSites: ordered }));
    void shell.setSelection(ordered).then((state) => {
      if (request !== selectionRequest.current) return;
      pendingSelection.current = null;
      accept(state);
    }).catch(() => { if (request === selectionRequest.current) recover(); });
  };
  const selected = useMemo(() => new Set(workspace.selectedSites), [workspace.selectedSites]);
  return {
    workspace,
    selected,
    currentSelection: () => selectionRef.current,
    accept,
    changeSelection,
    toggleSite: (site: SiteKey) => {
      const next = new Set(selectionRef.current);
      if (next.has(site)) next.delete(site); else next.add(site);
      changeSelection([...next]);
    },
    changeTier: (tier: Tier) => {
      setWorkspace((current) => ({ ...current, tier }));
      void shell.setTier(tier).then(accept).catch(recover);
    },
    saveGroup: async (name: string): Promise<boolean> => {
      try {
        accept(await shell.saveGroup({ name, sites: [...selectionRef.current] }));
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
