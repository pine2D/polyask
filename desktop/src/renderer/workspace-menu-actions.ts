import type { CommandActions } from "./command-dispatcher";
import { executeCommand } from "./command-dispatcher";
import { moreMenuCommandIds } from "./toolbar-fit";
import type { ActiveWorkspaceGroup } from "../shared/workspace";
import type { SiteKey } from "../shared/contracts";
import { elementPopupAnchor } from "../shared/popup-anchor";
import { shell } from "./shell-api";

/** Platinum popup menu ACKs dispatch through the same current command and participation owners. */
export function workspaceMenuActions(
  groups: readonly ActiveWorkspaceGroup[],
  change: (sites: readonly SiteKey[]) => Promise<boolean>,
  commands: { current: CommandActions },
  onError: () => void
) {
  return {
    showGroupMenu: async () => {
      try {
        const trigger = typeof document !== "undefined" ? document.querySelector(".scope-split") ?? document.querySelector(".scope-menu") : null;
        const menuBtn = typeof document !== "undefined" ? document.querySelector(".scope-menu") : null;
        const anchor = elementPopupAnchor(trigger, "start", menuBtn !== null && document.activeElement === menuBtn);
        const id = await (anchor ? shell.showGroupMenu(anchor) : shell.showGroupMenu());
        const group = groups.find((candidate) => candidate.id === id);
        if (group) void change(group.sites);
      } catch {
        onError();
      }
    },
    showMoreMenu: async () => {
      try {
        const trigger = typeof document !== "undefined" ? document.querySelector(".more-trigger") : null;
        const anchor = elementPopupAnchor(trigger, "end", trigger !== null && document.activeElement === trigger);
        const ids = moreMenuCommandIds().filter((id) => !!commands.current[id]);
        const command = await (anchor ? shell.showCommandMenu(ids, anchor) : shell.showCommandMenu(ids));
        if (command) executeCommand(command, commands.current);
      } catch {
        onError();
      }
    }
  };
}
