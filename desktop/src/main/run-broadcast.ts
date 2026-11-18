import type { BroadcastRequest, SiteRunResult } from "../shared/protocol";
import { IMAGE_BROADCAST_BUDGET_MS, TEXT_BROADCAST_BUDGET_MS, type BroadcastCoordinator } from "./broadcast";
import type { BroadcastResultReceiver } from "./broadcast-result";
import type { CollectionService } from "./collection-service";
import type { PreferenceRuntime } from "./preference-runtime";
import type { QuestionCaptureService } from "./question-capture-service";
import type { RecentPromptService } from "./recent-prompt-service";
import { statusForSending } from "./status";
import { lateSentResult } from "./submission-upgrade";
import { captureTierPresets } from "./tier-preset-routing";
import type { ViewManager } from "./view-manager";

interface BroadcastServices {
  collection: Pick<CollectionService, "beginRun">;
  capture: Pick<QuestionCaptureService, "prepareRun">;
  broadcastResults: Pick<BroadcastResultReceiver, "begin">;
  manager: Pick<ViewManager, "getStatuses" | "beginGenerationRun" | "markStatus" | "sendCommand" | "confirmSubmitted">;
  coordinator: Pick<BroadcastCoordinator, "send">;
  recentPrompts: Pick<RecentPromptService, "record">;
  publishPromptLibrary: () => void;
  preferences?: Pick<PreferenceRuntime, "snapshot">;
}

/** 调用方已校验请求并持有操作锁。旧轮或已迟到确认的站不能再次派发。 */
export async function runBroadcast(request: BroadcastRequest, services: BroadcastServices): Promise<SiteRunResult[]> {
  const { collection, capture, broadcastResults, manager, coordinator, recentPrompts, publishPromptLibrary } = services;
  const preset = captureTierPresets(services.preferences?.snapshot().values);
  collection.beginRun(request.runId, request.sites);
  const budget = request.images.length ? IMAGE_BROADCAST_BUDGET_MS : TEXT_BROADCAST_BUDGET_MS;
  const { remaining, dispatch, settled, historyTokens } = await capture.prepareRun(request, budget, lateSentResult(manager, request.runId));
  const receiveResult = broadcastResults.begin(dispatch, historyTokens);
  manager.beginGenerationRun(request.runId, dispatch.sites);

  // 即使全站失败，用户也能从最近提问重新取回文字。历史库读写失败仍须继续派发。
  try { recentPrompts.record(request.text); } catch { /* best effort */ }
  try { publishPromptLibrary(); } catch { /* best effort */ }
  for (const site of dispatch.sites) manager.markStatus(statusForSending(site, request.runId));
  const results = await coordinator.send(
    dispatch,
    (site, command, signal) => manager.sendCommand(site, { ...command, preset: preset(site, command.tier), historyToken: historyTokens.get(site) }, signal),
    remaining,
    receiveResult,
    { confirm: (site, command, signal) => manager.confirmSubmitted(site, command, signal) }
  );
  return [...settled, ...results];
}
