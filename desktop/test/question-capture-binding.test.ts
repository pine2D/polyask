import assert from "node:assert/strict";
import test from "node:test";
import { createQuestionCapture } from "../src/main/question-capture-binding";
import type { QuestionHistoryService } from "../src/main/question-history-service";
import type { ViewManager } from "../src/main/view-manager";
import type { SiteKey } from "../src/shared/contracts";

test("view protection includes pending submissions and synthesis awaiting save", () => {
  let token: string | undefined = "pending-not-yet-ready";
  let synthesis: SiteKey | undefined = "kimi";
  let protectedSite!: (site: SiteKey) => boolean;
  let releasable!: (site: SiteKey) => boolean;
  let invalidate!: (sites: readonly SiteKey[]) => void;
  let invalidated: readonly SiteKey[] = [];
  const history = { token: (site: SiteKey) => site === "claude" ? token : undefined,
    releasable: (site: SiteKey) => site === "claude" && token === undefined,
    clearReleaseEvidence: (sites: readonly SiteKey[]) => { invalidated = sites; }, cancel() {}, setSubmissionHandler() {}, setGenerationResumeHandler() {} } as unknown as QuestionHistoryService;
  const manager = { setCapturePending: (check: typeof protectedSite, ready: typeof releasable, clear: typeof invalidate) => {
    protectedSite = check; releasable = ready; invalidate = clear;
  }, onGenerationComplete() {} } as unknown as ViewManager;
  const capture = createQuestionCapture(history, manager, site => synthesis === site);
  try {
    assert.equal(protectedSite("claude"), true);
    assert.equal(protectedSite("kimi"), true);
    token = undefined;
    assert.equal(protectedSite("claude"), false);
    assert.equal(releasable("claude"), true);
    invalidate(["claude"]);
    assert.deepEqual(invalidated, ["claude"]);
    assert.equal(protectedSite("kimi"), true);
    synthesis = undefined;
    assert.equal(protectedSite("kimi"), false);
  } finally { capture.dispose(); }
});
