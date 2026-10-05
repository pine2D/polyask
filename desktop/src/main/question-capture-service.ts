import type { SiteKey } from "../shared/contracts";
import type { HistorySnapshot } from "../shared/question-capture";
import type { BroadcastRequest, SiteRunResult } from "../shared/protocol";
import type { QuestionHistoryService } from "./question-history-service";

export interface PreparedRun { remaining: number; dispatch: BroadcastRequest; settled: SiteRunResult[] }

/** Bounded, independent of the UI's single-run generation monitor. */
export class QuestionCaptureService {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private epoch = 0;
  private running: Promise<void> | null = null;
  private rush = false;
  private observed = new Set<string>();
  constructor(private readonly history: QuestionHistoryService,
    private readonly read: (site: SiteKey, token: string, deadline: number) => Promise<HistorySnapshot>,
    private readonly afterPoll: () => void = () => {}) {}
  start(delay = 5_000): void {
    if (this.timer || this.running) return;
    this.timer = setTimeout(() => { this.timer = null; void this.tick(); }, delay);
    this.timer.unref();
  }
  /**
   * 开轮前先把上一轮在采的站读完一遍。这次 flush 可能凭归属快照把同 runId 重试里的「提交未确认」站升为已发送：
   * settled 认出这样的站，它们不再开新尝试、也不得派发（dispatch 里剔除），直接以 settled 结果回给渲染层。
   */
  async prepareRun(request: BroadcastRequest, budgetMs: number,
    settle: (site: SiteKey) => SiteRunResult | null = () => null): Promise<PreparedRun> {
    const deadline = Date.now() + budgetMs;
    const lifecycle = this.history.repository.lifecycle;
    await this.flush(this.history.targets().map(entry => entry.site));
    if (this.history.repository.lifecycle !== lifecycle) throw new Error("cancelled");
    const settled = request.sites.flatMap(site => settle(site) ?? []);
    const dispatch = settled.length ? { ...request, sites: request.sites.filter(site => !settled.some(r => r.site === site)) } : request;
    if (dispatch.sites.length) this.history.begin(dispatch);
    return { remaining: Math.max(1, deadline - Date.now()), dispatch, settled };
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
      if (epoch === this.epoch) {
        if (!this.history.targets().length) this.rush = false;
        else if (this.rush) { this.rush = false; void this.tick(); } else this.start(this.nextDelay());
        this.afterPoll();
      }
    }
  }
  private async poll(epoch: number, deadline: number, observed: Set<string>, sites?: readonly SiteKey[]): Promise<void> {
    const queue = this.history.targets().filter(e => !sites || sites.includes(e.site));
    const worker = async () => {
      while (queue.length && epoch === this.epoch && Date.now() < deadline) {
        const entry = queue.shift()!;
        const mark = this.history.readMark();
        try {
          const result = await this.read(entry.site, entry.token, Math.min(deadline, Date.now() + 2_500));
          if (epoch === this.epoch) this.history.accept(entry.site, result, mark);
        } catch {
          if (epoch === this.epoch) this.history.accept(entry.site, { token: entry.token, owned: false }, mark);
        }
        observed.add(entry.token);
      }
    };
    await Promise.all([worker(), worker()]);
  }
  // 有封存候选时提前排复读：候选回包起满 SEAL_QUIET_MS 再开始读（+50ms 防计时取整），最长仍是 5s 一轮。
  private nextDelay(): number {
    const due = this.history.sealDelay();
    return due === null ? 5_000 : Math.min(5_000, due + 50);
  }
  /**
   * 外壳生成监视确认本轮回答结束：记下正向证据并尽快读一次，赶在用户追问/点页面冻结副本之前记下封存候选；
   * 隔 SEAL_QUIET_MS 复读逐字相同才封存（question-history-service.ts）。
   * 正在跑的一轮读取开始于确认之前，不算数；它结束后照常排下一轮。
   */
  complete(runId: string, site: SiteKey): void {
    if (!this.history.complete(runId, site)) return;
    if (this.running) this.rush = true; else void this.tick();
  }
  dispose(): void {
    this.epoch++;
    this.rush = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.history.cancel();
  }
}
