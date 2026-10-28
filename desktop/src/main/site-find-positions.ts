import { findPositionScript } from './site-find-position-script';

export interface PositionContents {
  isDestroyed(): boolean;
  executeJavaScriptInIsolatedWorld?(world: number, scripts: { code: string }[]): Promise<unknown>;
}

// 查找换词会重建 binding；仍需跨实例限制同一个页面的未完成执行。
const reading = new WeakSet<PositionContents>();

function parse(value: unknown): readonly number[] | undefined {
  if (!Array.isArray(value) || !value.length || value.length > 1000 ||
    value.some(n => typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > 1)) return undefined;
  return [...new Set(value as number[])].sort((a, b) => a - b);
}

/** 每个 WebContents 最多一个读取；失效/超时只撤销位置条，不影响原生查找。 */
export class SiteFindPositions {
  private epoch = 0;
  private pending?: { query: string; matches: number; epoch: number; deadline: number };
  private timer?: ReturnType<typeof setTimeout>;
  private deadline?: ReturnType<typeof setTimeout>;
  private running = false;
  private disposed = false;
  constructor(private readonly contents: PositionContents, private readonly publish: (positions: readonly number[] | undefined) => void) {}
  refresh(query: string, matches: number): void {
    if (this.disposed) return;
    clearTimeout(this.timer);
    this.pending = { query, matches, epoch: ++this.epoch, deadline: Date.now() + 1200 };
    if (!query || matches <= 0) { this.cancel(); return; }
    clearTimeout(this.deadline);
    const epoch = this.epoch;
    this.deadline = setTimeout(() => { if (!this.disposed && epoch === this.epoch) this.publish(undefined); }, 1200);
    if (!this.running) this.timer = setTimeout(() => { void this.read(); }, 100);
  }
  cancel(): void {
    this.epoch++; this.pending = undefined;
    clearTimeout(this.timer); clearTimeout(this.deadline);
    this.publish(undefined);
  }
  dispose(): void { this.disposed = true; this.cancel(); }
  private async read(): Promise<void> {
    const request = this.pending;
    if (!request || this.disposed || this.running || this.contents.isDestroyed() || !this.contents.executeJavaScriptInIsolatedWorld) return;
    if (Date.now() >= request.deadline) { this.publish(undefined); return; }
    if (reading.has(this.contents)) { this.timer = setTimeout(() => { void this.read(); }, 100); return; }
    reading.add(this.contents);
    this.running = true;
    const current = () => !this.disposed && request.epoch === this.epoch && !this.contents.isDestroyed() && Date.now() < request.deadline;
    try {
      const result = await this.contents.executeJavaScriptInIsolatedWorld(1101, [{ code: findPositionScript(request.query, request.matches) }]);
      if (current()) this.publish(parse(result));
    } catch { if (current()) this.publish(undefined); }
    finally {
      if (this.pending?.epoch === request.epoch) clearTimeout(this.deadline);
      this.running = false; reading.delete(this.contents);
      if (!this.disposed && this.pending && this.pending.epoch !== request.epoch)
        this.timer = setTimeout(() => { void this.read(); }, 100);
    }
  }
}
