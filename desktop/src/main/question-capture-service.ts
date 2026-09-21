import type { SiteKey } from "../shared/contracts";
import type { HistorySnapshot } from "../shared/question-capture";
import type { QuestionHistoryService } from "./question-history-service";

/** Bounded, independent of the UI's single-run generation monitor. */
export class QuestionCaptureService {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private epoch = 0;
  private running = false;
  constructor(private readonly history: QuestionHistoryService,
    private readonly read: (site: SiteKey, token: string, deadline: number) => Promise<HistorySnapshot>) {}
  start(): void {
    if (this.timer || this.running) return;
    this.timer = setTimeout(() => { this.timer = null; void this.tick(); }, 5_000);
    this.timer.unref();
  }
  async flush(sites: readonly SiteKey[]): Promise<void> { await this.tick(Date.now() + 2_500, sites); }
  async tick(deadline = Infinity, sites?: readonly SiteKey[]): Promise<void> {
    if (this.running) return;
    this.running = true;
    const epoch = this.epoch, queue = this.history.targets().filter(e => !sites || sites.includes(e.site));
    try {
      const worker = async () => {
        while (queue.length && epoch === this.epoch && Date.now() < deadline) {
          const entry = queue.shift()!;
          try {
            const result = await this.read(entry.site, entry.token, Math.min(deadline, Date.now() + 2_500));
            if (epoch === this.epoch) this.history.accept(entry.site, result);
          } catch {
            if (epoch === this.epoch) this.history.accept(entry.site, { token: entry.token, owned: false });
          }
        }
      };
      await Promise.all([worker(), worker()]);
    } finally {
      this.running = false;
      if (epoch === this.epoch && this.history.targets().length) this.start();
    }
  }
  dispose(): void {
    this.epoch++;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.history.cancel();
  }
}
