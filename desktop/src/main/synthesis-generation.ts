import { captureTierPresets } from "./tier-preset-routing";
import type { PreferenceValues } from "../shared/preferences";
import { randomUUID } from "node:crypto";
import type { BroadcastPayload } from "../shared/protocol";
import type { BroadcastCoordinator } from "./broadcast";
import type { ViewManager } from "./view-manager";
import { statusForResult } from "./status";

/** Assisted sends have completion watches, but never modify broadcast counters. */
export function sendTrackedSynthesis(request: BroadcastPayload, manager: ViewManager,
  coordinator: BroadcastCoordinator, budget: number, preferences?: PreferenceValues) {
  const preset = captureTierPresets(preferences);
  const runId = `synthesis-${randomUUID()}`;
  manager.beginGenerationRun(runId, request.sites, false);
  for (const site of request.sites) manager.markStatus({ site, phase: "sending", operationRunId: runId });
  return coordinator.send(request,
    (site, command, signal) => manager.sendCommand(site, { ...command, preset: preset(site, command.tier), historyToken: runId }, signal), budget,
    result => {
      manager.markStatus({ ...statusForResult(result.site, result), operationRunId: runId });
      if (result.ok) manager.watchGeneration(runId, result.site);
    },
    { confirm: (site, command, signal) => manager.confirmSubmitted(site, command, signal) });
}
