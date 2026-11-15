import type { WebContentsView } from "electron";

import type { SiteKey } from "../shared/contracts";
import {
  parseGenerationState,
  type GenerationSiteCommand,
  type SiteStatus
} from "../shared/protocol";
import { GenerationMonitor } from "./generation-monitor";
import {
  clearProbeTracking,
  generationObservationStatus,
  scheduleGenerationProbe
} from "./generation-probe-scheduler";
import { navigationDisposition } from "./navigation";
import type { SiteCommandChannel } from "./site-command-channel";
import { generationEndedForRelease } from "./site-page-protection";
import { SITES } from "./sites";

export interface GenerationWatcherDeps {
  readonly getView: (site: SiteKey) => WebContentsView | undefined;
  readonly commands: Pick<SiteCommandChannel, "send">;
  readonly currentStatus: (site: SiteKey) => SiteStatus;
  readonly markStatus: (status: SiteStatus) => void;
}

export class GenerationWatcher {
  readonly monitor = new GenerationMonitor();
  readonly timers = new Map<SiteKey, NodeJS.Timeout>();
  readonly deadlines = new Map<SiteKey, number>();
  readonly observed = new Set<SiteKey>();
  readonly misses = new Map<SiteKey, number>();

  constructor(private readonly deps: GenerationWatcherDeps) {}

  attempt(site: SiteKey): ReturnType<GenerationMonitor["attempt"]> {
    return this.monitor.attempt(site);
  }

  setOnComplete(listener: GenerationMonitor["onComplete"]): void {
    this.monitor.onComplete = listener;
  }

  observationEnded(site: SiteKey, currentStatus: SiteStatus, captureReleaseConfirmed: boolean): boolean {
    return generationEndedForRelease(
      currentStatus,
      this.deadlines.get(site),
      this.misses.get(site) ?? 0,
      captureReleaseConfirmed
    );
  }

  beginRun(runId: string, sites: readonly SiteKey[], submission = true): boolean {
    const resumed = this.monitor.begin(runId, sites, submission);
    for (const site of sites) this.clearTracking(site);
    return resumed;
  }

  watch(runId: string, site: SiteKey, resumed = false): void {
    if (resumed && this.monitor.reopen(runId, site)) this.clearTracking(site);
    if (!this.monitor.accepts(runId, site) || this.deadlines.has(site)) return;
    this.deadlines.set(site, Date.now() + 45_000);
    void this.probe(runId, site);
  }

  invalidate(site: SiteKey): void {
    this.monitor.forget(site);
    this.clearTracking(site);
  }

  cancel(sites?: readonly SiteKey[]): void {
    this.monitor.invalidate(sites);
    if (sites) for (const site of sites) this.clearTracking(site);
    else this.clearTracking();
  }

  clearTracking(site?: SiteKey): void {
    clearProbeTracking(
      {
        timers: this.timers,
        deadlines: this.deadlines,
        observed: this.observed,
        misses: this.misses
      },
      site
    );
  }

  async probe(runId: string, site: SiteKey): Promise<void> {
    const ticket = this.monitor.ticket(runId, site);
    if (!ticket) return;
    const view = this.deps.getView(site);
    const definition = SITES.find((candidate) => candidate.key === site);
    const reachable = !!view && !view.webContents.isDestroyed() && !!definition &&
      navigationDisposition(definition, view.webContents.getURL()) === "site";
    if (!reachable || !view) {
      this.scheduleProbe(runId, site, false);
      return;
    }
    const command: GenerationSiteCommand = {
      source: "AMS",
      cmd: "generation",
      runId,
      deadline: Date.now() + 2_500
    };
    const response = await this.deps.commands.send(view.webContents, command, {
      timeoutResult: { state: null }
    });
    if (!this.monitor.holds(ticket, site)) return;
    const state = "state" in response ? parseGenerationState(response.state) : null;
    const phase = this.monitor.accept(runId, site, state);
    if (!phase) return;
    // No state this round: keep polling until the miss budget runs out, so one
    // busy renderer cannot freeze the site on "submitted" for the whole run.
    if (state === null) {
      this.scheduleProbe(runId, site, false);
      return;
    }
    if (phase === "generating" && !this.observed.has(site)) {
      this.observed.add(site);
      this.deadlines.set(site, Date.now() + 15 * 60_000);
    }
    if ((phase === "generating" || phase === "complete") && this.deps.currentStatus(site).phase !== phase) {
      this.deps.markStatus({ site, phase, generation: { runId, state: phase } });
    }
    // Only the settled terminal phase stops the watch — the debounce window
    // inside GenerationMonitor still reports "generating" and must keep polling.
    if (phase === "complete") return;
    this.scheduleProbe(runId, site, true);
  }

  scheduleProbe(runId: string, site: SiteKey, observed: boolean): void {
    scheduleGenerationProbe(runId, site, observed, {
      misses: this.misses,
      deadlines: this.deadlines,
      timers: this.timers,
      stopped: () => this.deps.markStatus(generationObservationStatus(this.deps.currentStatus(site))),
      probe: (run, key) => { void this.probe(run, key); }
    });
  }
}
