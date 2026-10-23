import { siteStatusRunId, type SiteStatus } from "../shared/protocol";
import type { SiteKey } from '../shared/contracts';

interface NotificationCopy {
  readonly title: string;
  readonly complete: (site: string) => string;
  readonly failed: (site: string) => string;
  readonly summary?: (complete: number, failed: number) => string;
}

export interface CompletionNotice {
  readonly title: string; readonly body: string; readonly runId: string; readonly sites: readonly SiteKey[];
}
interface CompletionNotifierOptions {
  readonly copy: NotificationCopy;
  readonly focused: () => boolean;
  readonly show: (notification: CompletionNotice) => void;
}

interface SiteAttempt {
  runId: string; phase: SiteStatus['phase']; attempt: number; notified: Set<string>; retired: Set<string>;
}
interface PendingCompletion { site: SiteKey; label: string; complete: boolean }
interface Batch { timer: ReturnType<typeof setTimeout>; items: Map<SiteKey, PendingCompletion> }

export class CompletionNotifier {
  private enabled = false;
  private disposed = false;
  private readonly attempts = new Map<SiteKey, SiteAttempt>();
  private readonly batches = new Map<string, Batch>();

  constructor(private readonly options: CompletionNotifierOptions) {}

  setEnabled(value: boolean): void {
    this.enabled = value;
    if (!value) this.clearPending();
  }

  accept(status: SiteStatus, siteLabel: string): boolean {
    if (this.disposed) return false;
    const runId = siteStatusRunId(status);
    if (!runId) { this.removePending(status.site); return false; }
    let attempt = this.attempts.get(status.site);
    if (attempt?.retired.has(runId)) return false;
    if (!attempt || attempt.runId !== runId) {
      const retired = attempt?.retired ?? new Set<string>();
      if (attempt) retired.add(attempt.runId);
      if (retired.size > 16) retired.delete(retired.values().next().value!);
      this.removePending(status.site);
      attempt = { runId, phase: status.phase, attempt: 0, notified: new Set(), retired };
      this.attempts.set(status.site, attempt);
    } else if (status.phase === 'sending' && attempt.phase !== 'sending') {
      attempt.attempt++;
      attempt.notified.clear();
    }
    attempt.phase = status.phase;
    const complete = status.phase === 'complete' && status.generation?.state === 'complete' && status.generation.runId === runId;
    const failed = status.phase === 'failed' || status.phase === 'crashed';
    if (!complete && !failed) {
      this.removePending(status.site);
      return false;
    }
    const key = complete ? 'complete' : 'failed';
    // unread tracks tab visibility, never whether the window is in the foreground.
    if (!this.enabled || this.options.focused() || attempt.notified.has(key)) return false;
    attempt.notified.add(key);
    let batch = this.batches.get(runId);
    if (!batch) {
      batch = { timer: setTimeout(() => this.flush(runId), 800), items: new Map() };
      this.batches.set(runId, batch);
    }
    batch.items.set(status.site, { site: status.site, label: siteLabel, complete });
    return true;
  }

  private flush(runId: string): void {
    const batch = this.batches.get(runId);
    this.batches.delete(runId);
    if (!batch || this.disposed || !this.enabled || this.options.focused()) return;
    const items = [...batch.items.values()], completed = items.filter(item => item.complete).length;
    if (!items.length) return;
    const body = items.length > 1 && this.options.copy.summary
      ? this.options.copy.summary(completed, items.length - completed)
      : items.map(item => item.complete ? this.options.copy.complete(item.label) : this.options.copy.failed(item.label)).join('\n');
    try { this.options.show({ title: this.options.copy.title, body, runId, sites: items.map(item => item.site) }); }
    catch { /* A notification can never interrupt a broadcast. */ }
  }
  private removePending(site: SiteKey): void {
    for (const [runId, batch] of this.batches) {
      batch.items.delete(site);
      if (!batch.items.size) { clearTimeout(batch.timer); this.batches.delete(runId); }
    }
  }
  private clearPending(): void {
    for (const batch of this.batches.values()) clearTimeout(batch.timer);
    this.batches.clear();
  }
  currentRun(site: SiteKey): string | undefined { return this.attempts.get(site)?.runId; }
  reset(): void { this.enabled = false; this.clearPending(); this.attempts.clear(); }
  dispose(): void { this.disposed = true; this.clearPending(); this.attempts.clear(); }
}
