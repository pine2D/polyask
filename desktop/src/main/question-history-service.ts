import { randomUUID } from "node:crypto";
import type { SiteKey } from "../shared/contracts";
import type { BroadcastRequest, SiteRunResult } from "../shared/protocol";
import { normalizeHistorySnapshot, type HistorySnapshot, type CaptureReason } from "../shared/question-capture";
import type { QuestionAnswerRecord, QuestionRecord } from "../shared/question-history";
import { normalizeSelectionMetadata } from "../shared/selection";
import { QuestionRepository, questionAnswerId } from "./question-repository";

const OBSERVATION_MS = 15 * 60_000;
// 封存前的增长否决：确认后第一次读到的正文只记候选，之后开始的一次读在 ≥SEAL_QUIET_MS 后读到逐字相同才封存。
// 停止键消失后正文仍可能续长，实测最大 1.79s（ChatGPT，2026-10-04），留 ≥20% 余量取 3s，与 history.js 的 QUIET_MS 同源；
// 元宝输入框有草稿时停止键隐藏而回答仍在流（监视可能误收口），续长的正文也由它否决。这是正向确认之上的否决，不是完成证据。
export const SEAL_QUIET_MS = 3_000;
/** 一次快照读取开始时取的号：seq 区分确认前/后，at 是读取开始时刻（候选比对按开始时刻算，保守）。 */
export interface ReadMark { seq: number; at: number }

interface CaptureEntry {
  lifecycle: number; runId: string; token: string; answerId: string; questionId: string;
  started: number; deadline: number; ready: boolean; located?: boolean;
  // 外壳生成监视确认本轮回答已结束时的读序号（readMark）。只有之后才开始读的归属快照能据此封存为 complete。
  confirmedAt: number | null;
  // 确认之后第一次归属正文（at = 回包时刻，晚于正文采样）；被增长、截断、生成中或撤销确认清掉。
  candidate: { text: string; at: number } | null;
  // 迟到确认：本次回包时档位未确认（升级后照常记 tier_unconfirmed）；用户取消后不再升级（held）。
  tierUnconfirmed?: boolean; held?: boolean;
}
export class QuestionHistoryService {
  private lastRun: { lifecycle: number; runId: string; id: string } | null = null;
  private readonly active = new Map<SiteKey, CaptureEntry>();
  private readonly releasableSites = new Map<SiteKey, number>();
  private reportFailure: (() => void) | null = null;
  private reportSubmitted: ((runId: string, site: SiteKey) => void) | null = null;
  private reportResumed: ((runId: string, site: SiteKey) => void) | null = null;
  private reads = 0;
  constructor(readonly repository: QuestionRepository, private readonly options: {
    deviceId: () => string; now?: () => number; createId?: () => string; onFailure?: () => void;
    safeUrl?: (site: SiteKey, value: string) => string | null;
    // 本轮首次归属成功时回报定位级别（诊断记账，每轮一次）。
    onLocate?: (site: SiteKey, locate: NonNullable<HistorySnapshot["locate"]>) => void;
    // 站点运行时报来的本轮卡顿回调累计次数（诊断记账，同一轮重复上报由接收方按增量计）。
    onSlowObserver?: (site: SiteKey, token: string, count: number) => void;
    onReason?: (site: SiteKey, reason: NonNullable<HistorySnapshot["captureCode"]>) => void;
  }) {}
  private now(): number { return (this.options.now ?? Date.now)(); }
  setFailureHandler(handler: (() => void) | null): void { this.reportFailure = handler; }
  /** 迟到确认：本次尝试回包「提交未确认」后，归属快照给出本轮用户消息的正向证据，记录已升为 submitted 时回调（外壳据此改状态、开生成监视）。 */
  setSubmissionHandler(handler: ((runId: string, site: SiteKey) => void) | null): void { this.reportSubmitted = handler; }
  setGenerationResumeHandler(handler: ((runId: string, site: SiteKey) => void) | null): void { this.reportResumed = handler; }
  private revoke(site: SiteKey, entry: CaptureEntry): void {
    const confirmed = entry.confirmedAt !== null;
    entry.confirmedAt = null; entry.candidate = null;
    if (confirmed) { try { this.reportResumed?.(entry.runId, site); } catch { /* Saving must never break monitoring. */ } }
  }
  private guarded<T>(action: () => T, fallback: T): T {
    try { return action(); } catch { try { this.options.onFailure?.(); this.reportFailure?.(); } catch { /* Saving must never break sending. */ } return fallback; }
  }
  begin(request: BroadcastRequest): QuestionRecord | null {
    return this.guarded(() => {
      if (this.lastRun?.runId === request.runId && this.lastRun.lifecycle !== this.repository.lifecycle) return null;
      const existing = this.lastRun?.runId === request.runId ? this.repository.get(this.lastRun.id) : null;
      if (this.lastRun?.runId === request.runId && !existing) return null;
      if (existing && ("deletedAt" in existing || existing.text !== request.text || request.sites.some(s => !existing.sites.includes(s)))) return null;
      this.cancel(request.sites, "superseded");
      const now = this.now();
      const record: QuestionRecord = existing as QuestionRecord ?? {
        schema: 4, id: (this.options.createId ?? randomUUID)(), text: request.text, sites: [...request.sites],
        requestedTier: request.tier, inputImageCount: request.images.length,
        createdAt: now, updatedAt: now, deviceId: this.options.deviceId()
      };
      const pending = new Map<SiteKey, CaptureEntry>();
      this.repository.transaction(() => {
        if (!existing) this.repository.put(record);
        const previous = this.repository.answers(record.id);
        for (const site of request.sites) {
          const attempt = Math.max(0, ...previous.filter(a => a.site === site).map(a => a.attempt)) + 1;
          const answerId = questionAnswerId(record.id, site, attempt);
          this.repository.putAnswer({ schema: 4, id: answerId, questionId: record.id, site, attempt,
            createdAt: now, updatedAt: now, deviceId: this.options.deviceId(),
            submission: "pending", submissionCode: null, conversationUrl: null, answerMarkdown: null,
            capture: "waiting", captureCode: null, capturedAt: null, truncated: false, sealedAt: null });
          pending.set(site, { lifecycle: this.repository.lifecycle, runId: request.runId, token: randomUUID(), answerId, questionId: record.id,
            started: now, deadline: now + OBSERVATION_MS, ready: false, confirmedAt: null, candidate: null });
        }
      });
      this.lastRun = { lifecycle: this.repository.lifecycle, runId: request.runId, id: record.id };
      for (const [site, entry] of pending) this.active.set(site, entry);
      return record;
    }, null);
  }
  token(site: SiteKey): string | undefined { const e = this.active.get(site); return e?.lifecycle === this.repository.lifecycle ? e.token : undefined; }
  releasable(site: SiteKey): boolean { return this.releasableSites.get(site) === this.repository.lifecycle; }
  clearReleaseEvidence(sites: readonly SiteKey[]): void { for (const site of sites) this.releasableSites.delete(site); }
  delete(id: string): boolean {
    for (const [site, entry] of this.active) if (entry.questionId === id) { this.active.delete(site); this.releasableSites.delete(site); }
    return this.repository.delete(id, this.now(), this.options.deviceId());
  }
  targets(): { site: SiteKey; token: string }[] {
    return [...this.active].filter(([, e]) => e.ready && e.lifecycle === this.repository.lifecycle).map(([site, e]) => ({ site, token: e.token }));
  }
  private current(site: SiteKey): QuestionAnswerRecord | null {
    const e = this.active.get(site);
    if (!e) return null;
    if (e.lifecycle !== this.repository.lifecycle) { this.active.delete(site); return null; }
    const q = this.repository.get(e.questionId), a = this.repository.getAnswer(e.answerId);
    if (!q || "deletedAt" in q || !a || "deletedAt" in a || a.sealedAt !== null) { this.active.delete(site); return null; }
    return a;
  }
  /** 每次快照读取开始前取号；accept 用它区分「确认之后才读到的正文」与确认前已在途的读取。 */
  readMark(): ReadMark { return { seq: ++this.reads, at: this.now() }; }
  /** 距最早一个候选可复读封存还要多久（ms）；没有候选时为 null。采集服务据此提前排下一轮读。 */
  sealDelay(): number | null {
    const due = [...this.active.values()].flatMap(e => e.candidate && e.lifecycle === this.repository.lifecycle ? [e.candidate.at + SEAL_QUIET_MS] : []);
    return due.length ? Math.max(0, Math.min(...due) - this.now()) : null;
  }
  /** 新轮交接只等目标站已确认的候选；取最后一个到期点，不因其它站仍在生成而阻塞。 */
  handoffDelay(sites: readonly SiteKey[]): number | null {
    const due = sites.flatMap(site => { const e = this.active.get(site);
      return e?.candidate && e.lifecycle === this.repository.lifecycle ? [e.candidate.at + SEAL_QUIET_MS] : []; });
    return due.length ? Math.max(0, Math.max(...due) - this.now()) : null;
  }
  /**
   * 正向完成证据：外壳 GenerationMonitor 对本轮（同 runId、本次尝试已回包 ready）确认了回答结束。
   * 这里只记账不落库——封存要等之后开始的归属、未结束、非生成中的快照带着正文到来，且隔 SEAL_QUIET_MS 复读逐字相同（accept）。
   * 绝不从正文静止推断完成。返回是否记下了确认。
   */
  complete(runId: string, site: SiteKey): boolean {
    return this.guarded(() => {
      const e = this.active.get(site);
      if (!e || e.runId !== runId || !e.ready || !this.current(site)) return false;
      e.confirmedAt = this.reads; e.candidate = null;
      return true;
    }, false);
  }
  result(runId: string, result: SiteRunResult): void {
    this.guarded(() => {
      const e = this.active.get(result.site);
      if (!e || e.runId !== runId) return;
      const current = this.current(result.site);
      if (!current) return;
      const now = Math.max(this.now(), current.updatedAt + 1);
      const submission = result.ok ? "submitted" : result.code === "submit_unconfirmed" ? "unconfirmed" : result.code === "cancelled" ? "cancelled" : "failed";
      e.ready = submission === "submitted" || submission === "unconfirmed";
      e.tierUnconfirmed = normalizeSelectionMetadata(result).selection?.outcome === "unconfirmed";
      this.releasableSites.delete(result.site);
      e.deadline = now + OBSERVATION_MS;
      this.repository.putAnswer({ ...current, submission, submissionCode: result.code ?? null,
        updatedAt: now, capture: e.ready ? "waiting" : "unavailable", sealedAt: e.ready ? null : now });
      if (!e.ready) this.active.delete(result.site);
    }, undefined);
  }
  accept(site: SiteKey, snapshot: HistorySnapshot, mark?: ReadMark): void {
    this.guarded(() => {
      const e = this.active.get(site);
      if (!e || e.token !== snapshot.token || !e.ready) return;
      const current = this.current(site);
      if (!current) return;
      const now = Math.max(this.now(), current.updatedAt + 1);
      const v = normalizeHistorySnapshot(snapshot, e.token);
      if (v.captureCode && v.captureCode !== current.captureCode) { try { this.options.onReason?.(site, v.captureCode); } catch { /* Diagnostics only. */ } }
      if (v.slowObserver) { try { this.options.onSlowObserver?.(site, e.token, v.slowObserver); } catch { /* Diagnostics only. */ } }
      if (!v.owned) {
        // Stop and user-message DOM can both appear late. The fixed observation
        // budget starts at submission, without persisting unowned text or URLs.
        if (v.generation === "generating") this.revoke(site, e);
        if (v.ended || now >= e.deadline) {
          this.repository.putAnswer({ ...current, updatedAt: now, sealedAt: now, capture: current.answerMarkdown ? "interrupted" : "unavailable", captureCode: v.captureCode ?? (now >= e.deadline ? "capture_expired" : "turn_unconfirmed") });
          if (v.ended) this.releasableSites.set(site, this.repository.lifecycle);
          this.active.delete(site);
        } else if (v.captureCode && v.captureCode !== current.captureCode) {
          this.repository.putAnswer({ ...current, updatedAt: now, captureCode: v.captureCode });
        }
        return;
      }
      if (v.locate && !e.located) { e.located = true; try { this.options.onLocate?.(site, v.locate); } catch { /* Diagnostics only. */ } }
      const truncated = v.truncated ?? current.truncated;
      // 确认后又见生成中 = 证据被推翻，不再据此封存。已结束（冻结）的快照不知道冻结时刻，不算「确认之后」的正文。
      if (v.generation === "generating") this.revoke(site, e);
      // 没带读序号的快照来历不明，按确认前在途处理（fail-closed）。
      const fresh = e.confirmedAt !== null && mark !== undefined && mark.seq > e.confirmedAt;
      const settled = fresh && !v.ended && v.generation !== "generating" && !!v.text?.trim() && !truncated;
      let complete = false;
      const candidate = e.candidate;
      if (settled && candidate && candidate.text === v.text) complete = mark!.at - candidate.at >= SEAL_QUIET_MS;
      else if (settled) e.candidate = { text: v.text!, at: now };
      else if (fresh) e.candidate = null;
      const sealed = complete || !!v.ended || now >= e.deadline;
      const text = v.text?.trim() ? v.text : current.answerMarkdown;
      const capture = complete ? "complete" : text ? (v.generation === "generating" || truncated ? "partial" : "unknown") : sealed ? "unavailable" : "waiting";
      const conversationUrl = v.url ? this.options.safeUrl?.(site, v.url) ?? null : current.conversationUrl;
      // 迟到确认只升不降：与页内 history.submitted() 同一判据——本次 token 归属成功且不是原文锚点（锚点按本次原文找节点，循环论证）。
      // 已结束（冻结）快照、观察期已过都不升。这里只改记录，绝不触发任何发送或重发。
      // 用户取消（held）之后不再升级；档位未确认的照常记 tier_unconfirmed，与正常成功路径一致。
      const upgraded = current.submission === "unconfirmed" && !e.held && !v.ended && now < e.deadline
        && (v.locate === "selector" || v.locate === "semantic");
      const captureCode = complete ? null : now >= e.deadline ? "capture_expired" : v.captureCode ?? (text && !fresh ? "completion_unconfirmed" : current.captureCode);
      const next: QuestionAnswerRecord = { ...current, answerMarkdown: text, conversationUrl, capture, captureCode,
        ...(upgraded ? { submission: "submitted" as const, submissionCode: e.tierUnconfirmed ? "tier_unconfirmed" : null } : {}),
        capturedAt: v.text ? now : current.capturedAt, truncated, sealedAt: sealed ? now : null, updatedAt: now };
      if (upgraded || captureCode !== current.captureCode || text !== current.answerMarkdown || capture !== current.capture || conversationUrl !== current.conversationUrl || sealed) {
        this.repository.putAnswer(next, true, upgraded || sealed || !current.answerMarkdown ? 0 : now + 30_000);
      }
      if (upgraded) { try { this.reportSubmitted?.(e.runId, site); } catch { /* Status display must never break saving. */ } }
      if (sealed) {
        if (complete || v.ended) this.releasableSites.set(site, this.repository.lifecycle);
        this.active.delete(site);
      }
    }, undefined);
  }
  /** 用户取消：这些站当前尝试的迟到确认作废（采集照常，只是不再从「提交未确认」升为已发送）。 */
  holdSubmission(sites: readonly SiteKey[]): void {
    for (const site of sites) {
      const entry = this.active.get(site);
      if (entry) entry.held = true;
    }
  }
  cancel(sites: readonly SiteKey[] = [...this.active.keys()], reason: CaptureReason = "capture_cancelled"): void {
    for (const site of sites) this.guarded(() => {
      this.releasableSites.delete(site);
      const current = this.current(site);
      this.active.delete(site);
      if (!current) return;
      const now = Math.max(this.now(), current.updatedAt + 1);
      this.repository.putAnswer({ ...current, updatedAt: now, sealedAt: now, capture: "interrupted", captureCode: reason, submission: current.submission === "pending" ? "cancelled" : current.submission });
    }, undefined);
  }
}
