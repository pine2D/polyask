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
  const generation = status.generation && ['submitted', 'generating'].includes(status.generation.state)
    ? { ...status.generation, state: 'unconfirmed' as const } : status.generation;
  const value = generation ? { ...status, generation } : status;
  return status.phase === "submitted" || status.phase === "generating"
    ? { ...value, phase: "warning", code: "generation_unconfirmed" } : value;
}

interface ProbeTracking {
  timers: Map<SiteKey, NodeJS.Timeout>;
  deadlines: Map<SiteKey, number>;
  observed: Set<SiteKey>;
  misses: Map<SiteKey, number>;
}

/** 清掉本站（不传 site 则全部）的探测计时器、截止时间、已见生成中与连续未读计数。 */
export function clearProbeTracking(tracking: ProbeTracking, site?: SiteKey): void {
  const sites = site === undefined ? [...tracking.timers.keys()] : [site];
  for (const key of sites) {
    const timer = tracking.timers.get(key);
    if (timer) clearTimeout(timer);
  }
  for (const store of [tracking.timers, tracking.deadlines, tracking.observed, tracking.misses]) {
    if (site === undefined) store.clear();
    else store.delete(site);
  }
}
