import type { SiteKey } from "../shared/contracts";
import type { SiteStatus } from "../shared/protocol";
import { GENERATION_MISS_LIMIT, GENERATION_PROBE_INTERVAL } from "./generation-monitor";

interface ProbeSchedule {
  misses: Map<SiteKey, number>;
  deadlines: Map<SiteKey, number>;
  timers: Map<SiteKey, NodeJS.Timeout>;
  stopped(): void;
  probe(runId: string, site: SiteKey): void;
}

export function scheduleGenerationProbe(
  runId: string, site: SiteKey, observed: boolean, schedule: ProbeSchedule
): void {
  if (observed) schedule.misses.delete(site);
  else schedule.misses.set(site, (schedule.misses.get(site) ?? 0) + 1);
  if ((schedule.misses.get(site) ?? 0) >= GENERATION_MISS_LIMIT ||
      Date.now() >= (schedule.deadlines.get(site) ?? 0)) {
    schedule.stopped();
    return;
  }
  const timer = setTimeout(() => {
    schedule.timers.delete(site);
    schedule.probe(runId, site);
  }, GENERATION_PROBE_INTERVAL);
  timer.unref?.();
  schedule.timers.set(site, timer);
}

export function generationObservationStatus(status: SiteStatus): SiteStatus {
  return status.phase === "submitted" || status.phase === "generating"
    ? { ...status, phase: "warning", code: "generation_unconfirmed" }
    : status;
}
