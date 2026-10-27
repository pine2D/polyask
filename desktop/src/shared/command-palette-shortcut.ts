export type CommandPaletteShortcutMode = 'standard' | 'obsidian';
export type CommandPaletteShortcutError =
  | 'command_shortcut_read_failed'
  | 'command_shortcut_save_failed'
  | 'command_shortcut_apply_failed';
export interface CommandPaletteShortcutState {
  readonly mode: CommandPaletteShortcutMode;
  readonly revision: number;
  readonly error: CommandPaletteShortcutError | null;
}
export function parseCommandPaletteShortcut(value: unknown): CommandPaletteShortcutMode | null {
  return value === 'standard' || value === 'obsidian' ? value : null;
}
