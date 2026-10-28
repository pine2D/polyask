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
  const held = new Set<string>();
  const input = (event: Electron.Event, value: Electron.Input) => {
    const composing = !!value.isComposing;
    if (composing !== ignoring) { contents.setIgnoreMenuShortcuts(composing); ignoring = composing; }
    if (composing) { held.clear(); return; }
    const key = value.code || value.key.toLowerCase();
    if (value.type === 'keyUp' && held.delete(key)) { event.preventDefault(); return; }
    const command = commandAliasForInput({ ...value, type: 'keyDown' }, process.platform, getMode());
    if (!command) return;
    event.preventDefault();
    if (value.type !== 'keyDown' || value.isAutoRepeat) return;
    held.add(key); dispatch(command);
  };
  const cleanup = () => {
    contents.removeListener('before-input-event', input);
    contents.removeListener('destroyed', cleanup);
    if (!contents.isDestroyed() && ignoring) contents.setIgnoreMenuShortcuts(false);
    ignoring = false;
    held.clear();
  };
  contents.on('before-input-event', input); contents.once('destroyed', cleanup);
  return cleanup;
}
