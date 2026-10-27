import type { CommandPaletteShortcutMode } from '../shared/command-palette-shortcut';
import { commandAccelerator, type CommandId } from "../shared/commands";
import { shortcutLabel } from "./shortcut-label";

export function commandHint(label: string, command: CommandId, isMac = false, mode: CommandPaletteShortcutMode = 'standard'): string {
  const accelerator = commandAccelerator(command, isMac ? "darwin" : "win32", mode);
  if (!accelerator) return label;
  return `${label} (${shortcutLabel(accelerator, isMac)})`;
}
