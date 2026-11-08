import type { SiteKey } from '../shared/contracts';
import type { BroadcastRequest, SiteRunResult } from '../shared/protocol';
import { statusForResult } from './status';
import type { QuestionHistoryService } from './question-history-service';
import type { QuestionCaptureService } from './question-capture-service';
import type { ViewManager } from './view-manager';

/** Dispatch receipts outlive cancellation of history capture, but never a replacement dispatch. */
export class BroadcastResultReceiver {
  private runId: string | null = null;
  private readonly current = new Map<SiteKey, symbol>();
  constructor(private readonly questions: QuestionHistoryService, private readonly capture: QuestionCaptureService,
    private readonly manager: Pick<ViewManager, 'markStatus' | 'watchGeneration'>) {}

  begin(request: Pick<BroadcastRequest, 'runId' | 'sites'>, historyTokens: ReadonlyMap<SiteKey, string>): (result: SiteRunResult) => void {
    const { runId } = request;
    const lifecycle = this.questions.repository.lifecycle, dispatch = Symbol('broadcast-dispatch');
    const tokens = new Map(historyTokens);
    if (this.runId !== runId) this.current.clear();
    this.runId = runId;
    for (const site of request.sites) this.current.set(site, dispatch);
    return result => {
      if (this.questions.repository.lifecycle !== lifecycle || this.current.get(result.site) !== dispatch) return;
      // One terminal receipt per site. A cancelled receipt still closes sending after history.cancel removed its token.
      this.current.delete(result.site);
      this.questions.result(runId, result, tokens.get(result.site));
      this.capture.start();
      this.manager.markStatus(statusForResult(result.site, result, runId));
      if (result.ok) this.manager.watchGeneration(runId, result.site);
    };
  }
}
