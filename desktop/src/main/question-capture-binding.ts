import type { SiteKey } from "../shared/contracts";
import { QuestionCaptureService } from "./question-capture-service";
import type { QuestionHistoryService } from "./question-history-service";
import { upgradeSubmission } from "./submission-upgrade";
import type { ViewManager } from "./view-manager";

export function createQuestionCapture(history: QuestionHistoryService, manager: ViewManager,
  otherPending: (site: SiteKey) => boolean = () => false): QuestionCaptureService {
  // token() includes pending submissions, unlike targets() which only contains
  // entries ready to capture. A selection change must protect both stages.
  manager.setCapturePending(site => history.token(site) !== undefined || otherPending(site),
    site => history.releasable(site), sites => history.clearReleaseEvidence(sites));
  const capture = new QuestionCaptureService(history,
    (site, token, deadline) => manager.historyAccess.snapshot(site, token, deadline),
    () => manager.releaseUnselectedViews());
  // 正向完成证据只来自外壳生成监视（见过生成中/complete_observed 再连续确认），不看正文是否静止。
  manager.onGenerationComplete((runId, site) => capture.complete(runId, site));
  history.setGenerationResumeHandler((runId, site) => manager.watchGeneration(runId, site, true));
  // 迟到确认：「提交未确认」后页面上出现了本轮提问 → 只改状态、开监视，不发送（submission-upgrade.ts）。
  history.setSubmissionHandler((runId, site) => { upgradeSubmission(manager, runId, site); });
  return capture;
}

// 新会话 / 辅助综合导航前的保存预算：读一次（≤2.5s）+ 候选静默复读（≤3.05s）+ 复读，到点不阻塞导航。
export const SESSION_HANDOFF_MS = 6_000;
/** 离开会话前先读完在采的站（候选在预算内封存为完整），再结束这些站的采集——导航后旧会话已不在页面上。 */
export function sessionHandoff(history: QuestionHistoryService, capture: QuestionCaptureService) {
  return async (sites: readonly SiteKey[]): Promise<void> => {
    await capture.handoff(sites, SESSION_HANDOFF_MS);
    history.cancel(sites);
  };
}
