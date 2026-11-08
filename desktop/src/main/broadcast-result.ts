import type { SiteRunResult } from "../shared/protocol";
import { statusForResult } from "./status";
import type { QuestionHistoryService } from "./question-history-service";
import type { QuestionCaptureService } from "./question-capture-service";
import type { ViewManager } from "./view-manager";

export function acceptBroadcastResult(
  lifecycle: number, runId: string, result: SiteRunResult,
  questions: QuestionHistoryService, capture: QuestionCaptureService, manager: ViewManager, token: string | undefined
): void {
  if (questions.repository.lifecycle !== lifecycle) return;
  if (token && !questions.ownsResult(runId, result, token)) return;
  questions.result(runId, result, token);
  capture.start();
  manager.markStatus(statusForResult(result.site, result, runId));
  if (result.ok) manager.watchGeneration(runId, result.site);
}
