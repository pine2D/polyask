import type { SiteKey } from "../shared/contracts";
import { QuestionCaptureService } from "./question-capture-service";
import type { QuestionHistoryService } from "./question-history-service";
import type { ViewManager } from "./view-manager";

export function createQuestionCapture(history: QuestionHistoryService, manager: ViewManager,
  otherPending: (site: SiteKey) => boolean = () => false): QuestionCaptureService {
  // token() includes pending submissions, unlike targets() which only contains
  // entries ready to capture. A selection change must protect both stages.
  manager.setCapturePending(site => history.token(site) !== undefined || otherPending(site));
  return new QuestionCaptureService(history,
    (site, token, deadline) => manager.historyAccess.snapshot(site, token, deadline),
    () => manager.releaseUnselectedViews());
}
