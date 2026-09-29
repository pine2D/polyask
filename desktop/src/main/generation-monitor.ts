// Consecutive probes that read no state (renderer busy, adapter without a
// generation hook, view momentarily off-site) before monitoring gives up. A
// single miss must never end the watch: that stranded whole runs on "submitted".
export const GENERATION_MISS_LIMIT = 5;
export const GENERATION_PROBE_INTERVAL = 900;

import type { SiteKey } from "../shared/contracts";
import type { GenerationState, SitePhase } from "../shared/protocol";

// Consecutive "complete" readings required before a site settles on the terminal
// phase. Probes run every 900ms, so three readings span ~1.8s and survive the
// single-frame blind spots of the read-only detector (a stop control that
// re-renders at 0x0, a paused stream that resumes). Never infer completion from
// answer text that stopped growing — docs/desktop-workbench-ux.md 10.2.
const COMPLETE_CONFIRMATIONS = 3;

interface GenerationEntry {
  runId: string;
  observedGenerating: boolean;
  completeStreak: number;
  phase: "submitted" | "generating" | "complete";
}

export class GenerationMonitor {
  private runId: string | null = null;
  private readonly entries = new Map<SiteKey, GenerationEntry>();

  // Same-run retries preserve other sites' entries. Cancelling a dispatch
  // invalidates its pending sites; shutdown invalidates every watch.
  // A new run replaces only its own sites, retaining other unfinished turns.
  // The return value concerns broadcast retry identity, not assisted watches.
  begin(runId: string, sites: readonly SiteKey[], rememberBroadcast = true): boolean {
    const resumed = this.runId === runId;
    if (rememberBroadcast) this.runId = runId;
    for (const site of sites) {
      if (this.entries.get(site)?.runId === runId) continue;
      this.entries.set(site, { runId, observedGenerating: false, completeStreak: 0, phase: "submitted" });
    }
    return resumed;
  }

  invalidate(sites?: readonly SiteKey[]): void {
    if (!sites) { this.runId = null; this.entries.clear(); return; }
    for (const site of sites) {
      if (this.entries.get(site)?.runId === this.runId) this.runId = null;
      this.entries.delete(site);
    }
  }

  forget(site: SiteKey): void {
    this.entries.delete(site);
  }

  accepts(runId: string, site: SiteKey): boolean {
    return this.entries.get(site)?.runId === runId;
  }

  accept(runId: string, site: SiteKey, state: GenerationState): SitePhase | null {
    const entry = this.entries.get(site);
    if (!entry || entry.runId !== runId) return null;
    if (entry.phase === "complete") return "complete";
    if (state === "generating") {
      entry.observedGenerating = true;
      entry.completeStreak = 0;
      entry.phase = "generating";
    } else if (state === "idle") {
      entry.completeStreak = 0;
    } else if (state === "complete" && entry.observedGenerating) {
      entry.completeStreak += 1;
      if (entry.completeStreak >= COMPLETE_CONFIRMATIONS) entry.phase = "complete";
    }
    // state === null carries no information: it neither confirms nor resets the
    // streak, so an intermittent probe failure cannot strand a finished answer.
    return entry.phase;
  }
}
