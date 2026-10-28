interface FocusEffects {
  capture(): number | null;
  activate(): void;
  restore(contentsId: number): boolean;
}

/** Keep the original native source across overlapping panel geometry reservations. */
export class NativePanelFocus {
  private readonly layers = new Map<string, string | true>();
  private source: number | null = null;
  private captured = false;
  private pending: ((restored: boolean) => void) | null = null;

  constructor(private readonly effects: FocusEffects) {}

  change(layer: string, value: string | boolean, apply: () => void): void {
    const entering = value && this.layers.get(layer) !== value;
    if (entering) {
      this.finish(false);
      if (!this.layers.size && !this.captured) { this.source = this.effects.capture(); this.captured = true; }
    }
    if (value) this.layers.set(layer, value); else this.layers.delete(layer);
    apply();
    if (entering) this.effects.activate();
    if (!this.layers.size && this.pending) this.returnToSource();
  }

  restore(): Promise<boolean> {
    this.finish(false);
    return new Promise(resolve => {
      this.pending = resolve;
      if (!this.layers.size) this.returnToSource();
    });
  }

  cancel(): void { this.source = null; this.captured = false; this.finish(false); }
  cancelPending(): void { if (this.pending || !this.layers.size) this.cancel(); }
  reset(): void { this.layers.clear(); this.cancel(); }

  private returnToSource(): void {
    const source = this.source; this.source = null; this.captured = false;
    this.finish(source !== null && this.effects.restore(source));
  }
  private finish(restored: boolean): void {
    const pending = this.pending; this.pending = null; pending?.(restored);
  }
}
