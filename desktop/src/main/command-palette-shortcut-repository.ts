import type { MetaRepository } from './meta-repository';
import type { CommandPaletteShortcutMode } from '../shared/command-palette-shortcut';

export const COMMAND_PALETTE_SHORTCUT_META_KEY = 'commandPaletteShortcut';
/** Device-local only; reset clears meta, sync and business backups never project it. */
export class CommandPaletteShortcutRepository {
  constructor(private readonly meta: MetaRepository) {}
  read(): unknown { return this.meta.get(COMMAND_PALETTE_SHORTCUT_META_KEY); }
  write(mode: CommandPaletteShortcutMode): void { this.meta.put(COMMAND_PALETTE_SHORTCUT_META_KEY, mode); }
}
