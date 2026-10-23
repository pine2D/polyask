import { parseGlobalPromptShortcut, type GlobalPromptShortcutError, type GlobalPromptShortcutState } from '../shared/global-prompt-shortcut';

interface ShortcutRegistration { readonly accelerator: string }
export interface GlobalPromptShortcutOptions {
  readonly shortcuts: {
    register(accelerator: string, callback: () => void): boolean;
    unregister(accelerator: string): void;
  };
  readonly repository: { read(): unknown; write(accelerator: string | null): void };
  readonly activate: () => void;
  readonly platform?: string;
}

/** Owns exactly one binding. Failed replacements keep the previous working registration. */
export class GlobalPromptShortcutRuntime {
  private accelerator: string | null = null;
  private owned: ShortcutRegistration | null = null;
  private error: GlobalPromptShortcutError | null = null;
  private restored = false;
  private disposed = false;
  private epoch = 0;
  constructor(private readonly options: GlobalPromptShortcutOptions) {}

  get lifecycle(): number { return this.epoch; }
  getState(): GlobalPromptShortcutState {
    return { accelerator: this.accelerator, activeAccelerator: this.owned?.accelerator ?? null,
      status: this.owned ? 'registered' : this.accelerator === null ? 'disabled' : 'unavailable', error: this.error };
  }
  private parse(value: unknown): string | null | undefined {
    return parseGlobalPromptShortcut(value, (this.options.platform ?? process.platform) === 'darwin');
  }
  restore(): GlobalPromptShortcutState {
    if (this.disposed) return this.fail('unavailable');
    if (this.restored) return this.getState();
    this.restored = true;
    let value: string | null | undefined;
    try { value = this.parse(this.options.repository.read()); }
    catch { return this.fail('unavailable'); }
    if (value === undefined) return this.fail('invalid');
    this.accelerator = value;
    if (value !== null) this.owned = this.register(value, this.epoch);
    return this.getState();
  }
  configure(value: unknown): GlobalPromptShortcutState {
    if (this.disposed) return this.fail('unavailable');
    const next = this.parse(value);
    if (next === undefined) return this.fail('invalid');
    if (next === this.accelerator && (next === null ? this.error === null : this.owned)) { this.error = null; return this.getState(); }
    const epoch = this.epoch, previous = this.owned;
    const candidate = next === null ? null : this.register(next, epoch);
    if (next !== null && !candidate) return this.getState();
    if (epoch !== this.epoch || this.disposed) { this.release(candidate); return this.fail('unavailable'); }
    try { this.options.repository.write(next); }
    catch { this.release(candidate); return this.fail('save_failed'); }
    // Registration and SQLite writes are synchronous; retain this guard for lifecycle callbacks.
    if (epoch !== this.epoch || this.disposed) { this.release(candidate); return this.fail('unavailable'); }
    this.owned = candidate; this.accelerator = next; this.error = null; this.restored = true;
    this.release(previous);
    return this.getState();
  }
  /** Called after local reset; the database has already removed the preference. */
  reset(): GlobalPromptShortcutState {
    this.epoch++;
    const previous = this.owned; this.owned = null; this.accelerator = null; this.error = null; this.restored = true;
    this.release(previous);
    return this.getState();
  }
  /** Reset cleanup runs even when wiping failed: re-read before releasing a still-saved binding. */
  refreshAfterReset(): GlobalPromptShortcutState {
    const epoch = ++this.epoch;
    if (this.disposed) return this.getState();
    let next: string | null | undefined;
    try { next = this.parse(this.options.repository.read()); }
    catch { return this.fail('unavailable'); }
    if (next === undefined) return this.fail('invalid');
    if (next === null) return this.reset();
    if (next === this.accelerator) return this.getState();
    const previous = this.owned, candidate = this.register(next, epoch);
    if (epoch !== this.epoch || this.disposed) return this.getState();
    this.accelerator = next;
    if (candidate) { this.owned = candidate; this.release(previous); }
    return this.getState();
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true; this.reset();
  }
  private fail(error: GlobalPromptShortcutError): GlobalPromptShortcutState { this.error = error; return this.getState(); }
  private register(accelerator: string, epoch: number): ShortcutRegistration | null {
    const candidate = { accelerator };
    try {
      const registered = this.options.shortcuts.register(accelerator, () => {
        if (!this.disposed && this.owned === candidate) this.options.activate();
      });
      if (!registered) { this.error = 'conflict'; return null; }
      if (this.disposed || epoch !== this.epoch) { this.release(candidate); this.error = 'unavailable'; return null; }
      this.error = null;
      return candidate;
    } catch { this.error = 'unavailable'; return null; }
  }
  private release(registration: ShortcutRegistration | null): void {
    if (registration) this.options.shortcuts.unregister(registration.accelerator);
  }
}
