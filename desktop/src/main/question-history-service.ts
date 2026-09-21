import { randomUUID } from "node:crypto";
import type { SiteKey } from "../shared/contracts";
import type { BroadcastRequest, SiteRunResult } from "../shared/protocol";
import { normalizeHistorySnapshot, type HistorySnapshot } from "../shared/question-capture";
import type { QuestionAnswerRecord, QuestionRecord } from "../shared/question-history";
import { QuestionRepository, questionAnswerId } from "./question-repository";

interface CaptureEntry {
  lifecycle: number; runId: string; token: string; answerId: string; questionId: string;
  started: number; deadline: number; generating: boolean; completions: number; ready: boolean;
}
export class QuestionHistoryService {
  private lastRun: { lifecycle: number; runId: string; id: string } | null = null;
  private readonly active = new Map<SiteKey, CaptureEntry>();
  private reportFailure: (() => void) | null = null;
  constructor(readonly repository: QuestionRepository, private readonly options: {
    deviceId: () => string; now?: () => number; createId?: () => string; onFailure?: () => void;
    safeUrl?: (site: SiteKey, value: string) => string | null;
  }) {}
  private now(): number { return (this.options.now ?? Date.now)(); }
  setFailureHandler(handler: (() => void) | null): void { this.reportFailure = handler; }
  private guarded<T>(action: () => T, fallback: T): T {
    try { return action(); } catch { try { this.options.onFailure?.(); this.reportFailure?.(); } catch { /* Saving must never break sending. */ } return fallback; }
  }
  begin(request: BroadcastRequest): QuestionRecord | null {
    return this.guarded(() => {
      if (this.lastRun?.runId === request.runId && this.lastRun.lifecycle !== this.repository.lifecycle) return null;
      const existing = this.lastRun?.runId === request.runId ? this.repository.get(this.lastRun.id) : null;
      if (this.lastRun?.runId === request.runId && !existing) return null;
      if (existing && ("deletedAt" in existing || existing.text !== request.text || request.sites.some(s => !existing.sites.includes(s)))) return null;
      this.cancel(request.sites);
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
            started: now, deadline: now + 45_000, generating: false, completions: 0, ready: false });
        }
      });
      this.lastRun = { lifecycle: this.repository.lifecycle, runId: request.runId, id: record.id };
      for (const [site, entry] of pending) this.active.set(site, entry);
      return record;
    }, null);
  }
  token(site: SiteKey): string | undefined { const e = this.active.get(site); return e?.lifecycle === this.repository.lifecycle ? e.token : undefined; }
  delete(id: string): boolean {
    for (const [site, entry] of this.active) if (entry.questionId === id) this.active.delete(site);
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
  result(runId: string, result: SiteRunResult): void {
    this.guarded(() => {
      const e = this.active.get(result.site);
      if (!e || e.runId !== runId) return;
      const current = this.current(result.site);
      if (!current) return;
      const now = Math.max(this.now(), current.updatedAt + 1);
      const submission = result.ok ? "submitted" : result.code === "submit_unconfirmed" ? "unconfirmed" : result.code === "cancelled" ? "cancelled" : "failed";
      e.ready = submission === "submitted" || submission === "unconfirmed";
      e.deadline = now + 45_000;
      this.repository.putAnswer({ ...current, submission, submissionCode: result.code ?? null,
        updatedAt: now, capture: e.ready ? "waiting" : "unavailable", sealedAt: e.ready ? null : now });
      if (!e.ready) this.active.delete(result.site);
    }, undefined);
  }
  accept(site: SiteKey, snapshot: HistorySnapshot): void {
    this.guarded(() => {
      const e = this.active.get(site);
      if (!e || e.token !== snapshot.token || !e.ready) return;
      const current = this.current(site);
      if (!current) return;
      const now = Math.max(this.now(), current.updatedAt + 1);
      const v = normalizeHistorySnapshot(snapshot, e.token);
      if (!v.owned) {
        if (v.ended || now >= e.deadline) {
          this.repository.putAnswer({ ...current, updatedAt: now, sealedAt: now, capture: current.answerMarkdown ? "interrupted" : "unavailable" });
          this.active.delete(site);
        }
        return;
      }
      if (v.generation === "generating") { if (!e.generating) e.deadline = now + 15 * 60_000; e.generating = true; e.completions = 0; }
      else if (v.generation === "complete" && e.generating) e.completions++;
      else if (v.generation === "idle") e.completions = 0;
      const complete = e.completions >= 3;
      const sealed = complete || !!v.ended || now >= e.deadline;
      const text = v.text?.trim() ? v.text : current.answerMarkdown;
      const truncated = v.truncated ?? current.truncated;
      const capture = complete && text && !truncated ? "complete" : text ? (v.generation === "generating" || truncated ? "partial" : "unknown") : "waiting";
      const conversationUrl = v.url ? this.options.safeUrl?.(site, v.url) ?? null : current.conversationUrl;
      const next: QuestionAnswerRecord = { ...current, answerMarkdown: text, conversationUrl, capture,
        capturedAt: v.text ? now : current.capturedAt, truncated, sealedAt: sealed ? now : null, updatedAt: now };
      if (text !== current.answerMarkdown || capture !== current.capture || conversationUrl !== current.conversationUrl || sealed) {
        this.repository.putAnswer(next, true, sealed || !current.answerMarkdown ? 0 : now + 30_000);
      }
      if (sealed) this.active.delete(site);
    }, undefined);
  }
  cancel(sites: readonly SiteKey[] = [...this.active.keys()]): void {
    for (const site of sites) this.guarded(() => {
      const current = this.current(site);
      this.active.delete(site);
      if (!current) return;
      const now = Math.max(this.now(), current.updatedAt + 1);
      this.repository.putAnswer({ ...current, updatedAt: now, sealedAt: now, capture: "interrupted", submission: current.submission === "pending" ? "cancelled" : current.submission });
    }, undefined);
  }
}
