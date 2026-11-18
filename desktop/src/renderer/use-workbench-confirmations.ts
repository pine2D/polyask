import type { SiteDefinition } from "../shared/contracts";
import { formatCopy, type DesktopCopy } from "../shared/copy";
import type { DesktopSurface } from "../shared/protocol";
import type { ExclusiveActionLock } from "./broadcast-flow-state";
import { inspectBroadcastSite } from "./broadcast-site-inspection";
import type { CommandActions } from "./command-dispatcher";
import { restoreWorkbenchFocus } from "./composer-activation";
import { shell } from "./shell-api";
import type { useBroadcastFlow } from "./use-broadcast-flow";
import { useBroadcastRetryReview } from "./use-broadcast-retry-review";
import { useSitePageClose } from "./use-site-page-close";
import type { useWorkspaceFlow } from "./use-workspace-flow";
import type { WorkspacePanelTab } from "./workspace-panel-state";

export interface UseWorkbenchConfirmationsOptions {
  readonly copy: DesktopCopy;
  readonly sites: readonly SiteDefinition[];
  readonly broadcast: ReturnType<typeof useBroadcastFlow>;
  readonly workspaceFlow: ReturnType<typeof useWorkspaceFlow>;
  readonly actionLock: ExclusiveActionLock;
  readonly commandActions: { current: CommandActions };
  readonly runState: ReturnType<typeof useBroadcastFlow>["runState"];
  readonly auxiliaryBusy: boolean;
  readonly participationPending: boolean;
  readonly draftBlocking: boolean;
  readonly sitePageCloseConfirm: boolean;
  readonly onSitePageCloseConfirmChange: (enabled: boolean) => void;
  readonly drawerOpen: boolean;
  readonly changeDrawerOpen: (open: boolean) => void;
  readonly openPanel: (tab: WorkspacePanelTab, inputMethod: "pointer" | "keyboard") => void;
  readonly changeSurface: (surface: DesktopSurface) => void;
  readonly onAnnounce: (text: string) => void;
}

export function useWorkbenchConfirmations(options: UseWorkbenchConfirmationsOptions) {
  const {
    copy,
    sites,
    broadcast,
    workspaceFlow,
    actionLock,
    commandActions,
    runState,
    auxiliaryBusy,
    participationPending,
    draftBlocking,
    sitePageCloseConfirm,
    onSitePageCloseConfirmChange,
    drawerOpen,
    changeDrawerOpen,
    openPanel,
    changeSurface,
    onAnnounce
  } = options;

  const pageClose = useSitePageClose({
    copy,
    sites,
    busy: runState !== "idle" || auxiliaryBusy || participationPending || draftBlocking,
    api: shell,
    lock: actionLock,
    confirmClose: sitePageCloseConfirm,
    onConfirmCloseChange: onSitePageCloseConfirmChange,
    onOpen: () => {
      commandActions.current = {};
      changeSurface("confirmation");
    },
    onClose: () => {
      changeSurface("sites");
      restoreWorkbenchFocus();
    },
    onWorkspace: workspaceFlow.accept,
    onAnnounce
  });

  const retryReview = useBroadcastRetryReview({
    copy,
    sites,
    flow: broadcast,
    lock: actionLock,
    busy: runState !== "idle" || auxiliaryBusy || draftBlocking,
    onOpen: () => {
      changeSurface("sites");
      changeSurface("confirmation");
    },
    onClose: () => changeSurface("sites"),
    onInspect: (site, active) => inspectBroadcastSite(site, {
      isSelected: (key) => workspaceFlow.currentOpenedSites().includes(key),
      active,
      focus: async (key) => {
        const accepted = await shell.inspectSite(key);
        if (accepted === true && active()) {
          changeSurface("sites");
          if (drawerOpen) changeDrawerOpen(false);
        }
        return accepted;
      },
      unavailable: (key) => {
        changeSurface("sites");
        openPanel("sites", "keyboard");
        onAnnounce(formatCopy(copy.retrySiteClosed, {
          site: sites.find((item) => item.key === key)?.label ?? key
        }));
      }
    })
  });

  return { pageClose, retryReview };
}
