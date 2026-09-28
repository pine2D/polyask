import assert from "node:assert/strict";
import test from "node:test";
import { getCopy } from "../src/shared/copy";
import { describeStatus } from "../src/shared/status-copy";
import { pageSiteDetail } from "../src/renderer/page-submission";
import type { SiteStatus } from "../src/shared/protocol";

const preferred = { requested: "think", outcome: "preferred", observed: "think", model: "Known model" } as const;
test("status text distinguishes model confirmation from mode-only confirmation in each locale", () => {
  for (const locale of ["en", "zh-CN", "zh-TW"]) {
    const copy = getCopy(locale);
    const known = describeStatus(copy, { site: "claude", phase: "submitted", selection: preferred });
    assert.ok(known.includes(copy.submitted));
    assert.ok(known.includes(copy.think));
    assert.ok(known.includes("Known model"));
    const alternative = describeStatus(copy, { site: "claude", phase: "submitted", selection: { ...preferred, outcome: "alternative" } });
    assert.notEqual(alternative, known);
    assert.ok(alternative.includes("Known model"));
    const mode = describeStatus(copy, { site: "claude", phase: "submitted", selection: { requested: "fast", outcome: "mode_only", observed: "fast" } });
    assert.ok(mode.includes(copy.fast));
    assert.match(mode, /model not confirmed|模型未确认|模型未確認/);
  }
});

test("failure remains the leading status even when mode and model were confirmed", () => {
  for (const locale of ["en", "zh-CN", "zh-TW"]) {
    const copy = getCopy(locale);
    const text = describeStatus(copy, { site: "claude", phase: "failed", code: "attachment_failed", selection: preferred });
    assert.ok(text.startsWith(copy.attachmentFailed));
    assert.ok(text.includes("Known model"));
    assert.ok(!text.includes(copy.submitted));
    const inconsistent = describeStatus(copy, { site: "claude", phase: "failed", code: "tier_unconfirmed", selection: preferred });
    assert.ok(inconsistent.startsWith(copy.failed));
    assert.ok(!inconsistent.includes(copy.submitted));
  }
});

test("unconfirmed mode and submission evidence express the actual confirmation limit", () => {
  for (const locale of ["en", "zh-CN", "zh-TW"]) {
    const copy = getCopy(locale);
    const status = { site: "claude", phase: "warning", code: "tier_unconfirmed", selection: { requested: "think", outcome: "unconfirmed" } } as const;
    const message = describeStatus(copy, { ...status, submissionEvidence: "message" });
    const composer = describeStatus(copy, { ...status, submissionEvidence: "composer" });
    assert.match(message, /Current message seen|已看到本轮消息|已看到本輪訊息/);
    assert.match(composer, /Composer changed; message not confirmed|输入框已变化，消息未确认|輸入框已變更，訊息未確認/);
    assert.notEqual(message, composer);
    assert.doesNotMatch(message, /unchanged|保持不变|保持不變/);
  }
});

test("page tooltip includes evidence without needing a warning code and retains it after a crash", () => {
  const copy = getCopy("zh-CN");
  const submission = { runId: "run", state: "sent", selection: preferred, submissionEvidence: "message" } as const;
  for (const phase of ["submitted", "generating", "complete", "crashed"] as const) {
    const status: SiteStatus = { site: "claude", phase, submission };
    const text = pageSiteDetail("Claude", status, copy);
    assert.ok(text.includes("Known model"));
    assert.ok(text.includes("已看到本轮消息"));
    assert.equal(text.split("Known model").length - 1, 1);
    assert.equal(text.split("已看到本轮消息").length - 1, 1);
    if (phase === "crashed") assert.ok(text.includes(copy.crashed));
  }
});

test("live page tooltip shows each confirmation once after generation updates", () => {
  const copy = getCopy("zh-CN");
  const status: SiteStatus = {
    site: "claude", phase: "complete", selection: preferred, submissionEvidence: "message",
    submission: { runId: "run", state: "sent", selection: preferred, submissionEvidence: "message" }
  };
  const text = pageSiteDetail("Claude", status, copy);
  assert.equal(text.split("Known model").length - 1, 1);
  assert.equal(text.split("已看到本轮消息").length - 1, 1);
  assert.equal(text.split(copy.submitted).length - 1, 1);
  assert.ok(text.includes(copy.answerComplete));
});
