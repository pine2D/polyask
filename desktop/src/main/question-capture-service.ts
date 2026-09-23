import type { SiteKey } from "../shared/contracts";
import type { HistorySnapshot } from "../shared/question-capture";
import type { QuestionHistoryService } from "./question-history-service";

/** Bounded, independent of the UI's single-run generation monitor. */
export class QuestionCaptureService {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private epoch = 0;
  private running: Promise<void> | null = null;
  private observed = new Set<string>();
  constructor(private readonly history: QuestionHistoryService,
    private readonly read: (site: SiteKey, token: string, deadline: number) => Promise<HistorySnapshot>) {}
  start(): void {
    if (this.timer || this.running) return;
    this.timer = setTimeout(() => { this.timer = null; void this.tick(); }, 5_000);
    this.timer.unref();
  }
  async flush(sites: readonly SiteKey[]): Promise<void> {
    const deadline = Date.now() + 2_500;
    const pending = this.running, observed = this.observed, epoch = this.epoch;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const capture = async () => {
      if (pending) await pending;
      if (epoch !== this.epoch || Date.now() >= deadline) return;
      const missing = this.history.targets().filter(e => sites.includes(e.site) && (!pending || !observed.has(e.token)));
      if (missing.length) await this.tick(deadline, missing.map(e => e.site));
    };
    try {
      // Join the current poll: returning early would let navigation seal the
      // answer before its in-flight body is accepted. A stuck probe cannot hold
      // navigation indefinitely; the caller seals outstanding captures at 2.5s.
      await Promise.race([
        capture(),
        new Promise<void>(resolve => { timer = setTimeout(resolve, Math.max(0, deadline - Date.now())); })
      ]);
    } finally { if (timer) clearTimeout(timer); }
  }
  async tick(deadline = Infinity, sites?: readonly SiteKey[]): Promise<void> {
    if (this.running) return this.running;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const epoch = this.epoch;
    this.observed = new Set();
    this.running = this.poll(epoch, deadline, this.observed, sites);
    try {
      await this.running;
    } finally {
      this.running = null;
      if (epoch === this.epoch && this.history.targets().length) this.start();
    }
  }
  private async poll(epoch: number, deadline: number, observed: Set<string>, sites?: readonly SiteKey[]): Promise<void> {
    const queue = this.history.targets().filter(e => !sites || sites.includes(e.site));
    const worker = async () => {
      while (queue.length && epoch === this.epoch && Date.now() < deadline) {
        const entry = queue.shift()!;
        try {
          const result = await this.read(entry.site, entry.token, Math.min(deadline, Date.now() + 2_500));
          if (epoch === this.epoch) this.history.accept(entry.site, result);
        } catch {
          if (epoch === this.epoch) this.history.accept(entry.site, { token: entry.token, owned: false });
        }
        observed.add(entry.token);
      }
    };
    await Promise.all([worker(), worker()]);
  }
  dispose(): void {
    this.epoch++;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.history.cancel();
  }
}
