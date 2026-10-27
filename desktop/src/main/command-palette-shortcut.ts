import { parseCommandPaletteShortcut, type CommandPaletteShortcutMode, type CommandPaletteShortcutState,
  type CommandPaletteShortcutError } from '../shared/command-palette-shortcut';
import type { CommandPaletteShortcutRepository } from './command-palette-shortcut-repository';

interface Options {
  readonly repository: Pick<CommandPaletteShortcutRepository, 'read' | 'write'>;
  transaction<T>(action: () => T): T;
  prepare(mode: CommandPaletteShortcutMode): { commit(): void; rollback(): void };
  publish(state: CommandPaletteShortcutState): void;
}
/** A synchronous SQLite transaction and a prepared menu swap share one effective mode. */
export class CommandPaletteShortcutRuntime {
  private mode: CommandPaletteShortcutMode = 'standard';
  private revision = 0;
  private error: CommandPaletteShortcutError | null = null;
  private restored = false;
  private disposed = false;
  private epoch = 0;
  constructor(private readonly options: Options) {}
  get lifecycle(): number { return this.epoch; }
  getState(): CommandPaletteShortcutState { return { mode: this.mode, revision: this.revision, error: this.error }; }
  restore(): CommandPaletteShortcutState {
    if (this.disposed || this.restored) return this.getState();
    this.restored = true;
    return this.readAndApply();
  }
  configure(value: unknown): CommandPaletteShortcutState {
    if (this.disposed) return this.fail('command_shortcut_apply_failed');
    const mode = parseCommandPaletteShortcut(value);
    if (!mode) throw new Error('invalid_request');
    return this.apply(mode, true);
  }
  refreshAfterReset(): CommandPaletteShortcutState {
    this.epoch++;
    return this.disposed ? this.getState() : this.readAndApply();
  }
  dispose(): void { this.disposed = true; this.epoch++; }
  private readAndApply(): CommandPaletteShortcutState {
    let value: unknown;
    try { value = this.options.repository.read(); }
    catch { return this.fail('command_shortcut_read_failed'); }
    return this.apply(parseCommandPaletteShortcut(value) ?? 'standard', false);
  }
  private apply(mode: CommandPaletteShortcutMode, persist: boolean): CommandPaletteShortcutState {
    let menu: ReturnType<Options['prepare']>;
    try { menu = this.options.prepare(mode); }
    catch { return this.fail('command_shortcut_apply_failed'); }
    let failure: CommandPaletteShortcutError = 'command_shortcut_apply_failed';
    try {
      this.options.transaction(() => {
        if (persist) {
          failure = 'command_shortcut_save_failed'; this.options.repository.write(mode);
        }
        failure = 'command_shortcut_apply_failed'; menu.commit();
      });
    } catch {
      try { menu.rollback(); } catch { failure = 'command_shortcut_apply_failed'; }
      return this.fail(failure);
    }
    this.mode = mode; this.error = null;
    return this.publish();
  }
  private fail(error: CommandPaletteShortcutError): CommandPaletteShortcutState {
    this.error = error; return this.publish();
  }
  private publish(): CommandPaletteShortcutState {
    this.revision++;
    const state = this.getState();
    if (!this.disposed) this.options.publish(state);
    return state;
  }
}
