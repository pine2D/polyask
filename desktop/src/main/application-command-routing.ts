import { Menu, type WebContents } from 'electron';
import { applicationMenu } from './application-menu';
import { commandAliasForInput, type CommandId } from '../shared/commands';
import type { CommandPaletteShortcutMode } from '../shared/command-palette-shortcut';

export function prepareApplicationMenu(args: Parameters<typeof applicationMenu>): { commit(): void; rollback(): void } {
  const previous = Menu.getApplicationMenu();
  const candidate = Menu.buildFromTemplate(applicationMenu(...args));
  return { commit: () => Menu.setApplicationMenu(candidate), rollback: () => Menu.setApplicationMenu(previous) };
}

export function bindApplicationCommandInput(contents: WebContents, getMode: () => CommandPaletteShortcutMode,
  dispatch: (id: CommandId) => void): () => void {
  let ignoring = false;
  const input = (event: Electron.Event, value: Electron.Input) => {
    const composing = !!value.isComposing;
    if (composing !== ignoring) { contents.setIgnoreMenuShortcuts(composing); ignoring = composing; }
    const command = commandAliasForInput(value, process.platform, getMode());
    if (!command) return;
    event.preventDefault(); dispatch(command);
  };
  const cleanup = () => {
    contents.removeListener('before-input-event', input);
    contents.removeListener('destroyed', cleanup);
    if (!contents.isDestroyed() && ignoring) contents.setIgnoreMenuShortcuts(false);
    ignoring = false;
  };
  contents.on('before-input-event', input); contents.once('destroyed', cleanup);
  return cleanup;
}
