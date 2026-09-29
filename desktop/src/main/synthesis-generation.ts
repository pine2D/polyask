import { randomUUID } from "node:crypto";
import type { BroadcastPayload } from "../shared/protocol";
import type { BroadcastCoordinator } from "./broadcast";
import type { ViewManager } from "./view-manager";
import { statusForResult } from "./status";

/** Assisted sends have completion watches, but never modify broadcast counters. */
export function sendTrackedSynthesis(request: BroadcastPayload, manager: ViewManager,
  coordinator: BroadcastCoordinator, budget: number) {
  const runId = `synthesis-${randomUUID()}`;
  manager.beginGenerationRun(runId, request.sites, false);
  for (const site of request.sites) manager.markStatus({ site, phase: "sending" });
  return coordinator.send(request,
    (site, command, signal) => manager.sendCommand(site, command, signal), budget,
    result => {
      manager.markStatus(statusForResult(result.site, result));
      if (result.ok) manager.watchGeneration(runId, result.site);
    },
    { confirm: (site, command, signal) => manager.confirmSubmitted(site, command, signal) });
}
