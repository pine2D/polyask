export const TEMPLATE_UNDO_MS = 6000;

/** Delay the tombstone, so undo never needs to resurrect a cloud-deleted record. */
export class UndoableDeletions {
  private readonly pending = new Map<string, { timer: unknown }>();
  constructor(
    private readonly commit: (id: string) => void,
    private readonly changed: () => void,
    private readonly schedule: (fn: () => void) => unknown = (fn) => setTimeout(fn, TEMPLATE_UNDO_MS),
    private readonly cancel: (timer: unknown) => void = (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>)
  ) {}
  get ids(): string[] { return [...this.pending.keys()]; }
  add(id: string): void {
    if (this.pending.has(id)) return;
    const entry = { timer: undefined as unknown };
    this.pending.set(id, entry);
    entry.timer = this.schedule(() => {
      if (this.pending.get(id) !== entry) return;
      this.pending.delete(id);
      this.commit(id);
      this.changed();
    });
    this.changed();
  }
  undo(): void { this.dispose(); this.changed(); }
  dispose(): void {
    for (const entry of this.pending.values()) this.cancel(entry.timer);
    this.pending.clear();
  }
}
