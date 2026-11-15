import { useMemo, useRef, useState } from "react";
import type { SiteDefinition, SiteKey } from "../shared/contracts";
import type { DesktopCopy } from "../shared/copy";
import type { SiteStatus } from "../shared/protocol";
import type { RuntimeInfo } from "../shared/runtime";
import type { SiteHealth } from "../shared/site-health";
import { shell } from "./shell-api";
import { siteHealthActions } from "./site-health-actions";
import { useSiteHealthRefresh } from "./use-site-health-refresh";
import {
  openWorkspacePanel,
  type OpenWorkspacePanelState,
  type WorkspacePanelState
} from "./workspace-panel-state";

export interface UseSiteHealthPanelOptions {
  readonly copy: DesktopCopy;
  readonly sites: readonly SiteDefinition[];
  readonly selected: ReadonlySet<SiteKey>;
  readonly runtime: RuntimeInfo;
  readonly statuses: Record<string, SiteStatus>;
  readonly noteHealth: (text: string) => void;
  readonly onAnnounce: (text: string) => void;
}

export function useSiteHealthPanel(options: UseSiteHealthPanelOptions) {
  const { copy, sites, selected, runtime, statuses, noteHealth, onAnnounce } = options;
  const lastOpenPanel = useRef<OpenWorkspacePanelState>(openWorkspacePanel("sites", "pointer"));
  const [health, setHealth] = useState<Partial<Record<string, SiteHealth>>>({});
  const [panelState, setPanelState] = useState<WorkspacePanelState>(null);
  const { checking: healthChecking, refresh: refreshSiteHealth } = useSiteHealthRefresh(
    setHealth,
    () => onAnnounce(copy.healthRequestFailed)
  );

  if (panelState) lastOpenPanel.current = panelState;
  const drawerOpen = panelState !== null;

  const updatePanelState = (value: WorkspacePanelState, onBeforeOpen?: () => void): void => {
    if (value) {
      void shell.closeSiteFind(false).catch(() => {});
      onBeforeOpen?.();
    }
    setPanelState(value);
  };

  const healthAttention = useMemo(
    () => new Set([
      ...Object.values(statuses)
        .filter((status) => selected.has(status.site) && ["warning", "failed", "crashed"].includes(status.phase))
        .map((status) => status.site),
      ...Object.values(health)
        .filter((item) => item && selected.has(item.site) && ["sign-in", "error"].includes(item.state))
        .map((item) => item!.site)
    ]).size,
    [health, selected, statuses]
  );

  const drawerHealthActions = siteHealthActions({
    copy,
    sites,
    selected,
    runtime,
    statuses,
    health,
    setHealth,
    noteHealth
  });

  return {
    health,
    setHealth,
    healthChecking,
    refreshSiteHealth,
    healthAttention,
    panelState,
    lastOpenPanel,
    drawerOpen,
    updatePanelState,
    drawerHealthActions
  };
}
