import type { CommandActions } from './command-dispatcher';
import { executeCommand } from './command-dispatcher';
import { moreMenuCommandIds } from './toolbar-fit';
import type { ActiveWorkspaceGroup } from '../shared/workspace';
import type { SiteKey } from '../shared/contracts';
import { shell } from './shell-api';

/** Native menu ACKs dispatch through the same current command and participation owners. */
export function workspaceMenuActions(groups: readonly ActiveWorkspaceGroup[], change: (sites: readonly SiteKey[]) => Promise<boolean>,
  commands: {current: CommandActions}, onError: () => void) {
  return {
    showGroupMenu: async () => {
      try {
        const id = await shell.showGroupMenu();
        const group = groups.find(candidate => candidate.id === id);
        if (group) void change(group.sites);
      } catch { onError(); }
    },
    showMoreMenu: async () => {
      try {
        const command = await shell.showCommandMenu(moreMenuCommandIds().filter(id => !!commands.current[id]));
        if (command) executeCommand(command, commands.current);
      } catch { onError(); }
    }
  };
}
