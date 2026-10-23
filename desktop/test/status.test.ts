import assert from "node:assert/strict";
import test from "node:test";

import { beginSubmissionRun, effectiveStatus, markStatusRead, preserveSubmission, statusForResult, statusWithUnread } from "../src/main/status";
import { siteStatusRunId, type SiteStatus } from '../src/shared/protocol';
import { getCopy } from "../src/shared/copy";
import { describeCollectionCode } from "../src/shared/status-copy";

test('assisted run identity survives page failure and generation but is cleared by a new broadcast', () => {
  const sending: SiteStatus = { site: 'claude', phase: 'sending', operationRunId: 'synthesis-a' };
  const crashed = effectiveStatus(sending, { site: 'claude', phase: 'crashed', code: 'renderer_crashed' });
  assert.equal(siteStatusRunId(crashed), 'synthesis-a'); assert.equal(crashed.submission, undefined);
  const complete = preserveSubmission(sending, { site: 'claude', phase: 'complete' });
  assert.equal(siteStatusRunId(complete), 'synthesis-a'); assert.equal(complete.generation?.state, 'complete');
  assert.equal(complete.submission, undefined);
  const statuses = new Map<SiteStatus['site'], SiteStatus>([['claude', crashed]]);
  let published = 0;
  beginSubmissionRun(false, statuses, () => { published++; });
  assert.equal(siteStatusRunId(statuses.get('claude')), undefined); assert.equal(published, 1);
});

test("successful submit with an unconfirmed tier remains a visible warning", () => {
  assert.deepEqual(
    statusForResult("claude", { ok: true, code: "tier_unconfirmed" }),
    { site: "claude", phase: "warning", code: "tier_unconfirmed" }
  );
  assert.deepEqual(
    statusForResult("claude", { ok: true }),
    { site: "claude", phase: "submitted" }
  );
});

test("user cancellation is neutral rather than a send failure", () => {
  assert.deepEqual(
    statusForResult("claude", { ok: false, code: "cancelled" }),
    { site: "claude", phase: "cancelled", code: "cancelled" }
  );
});

test("page loading does not overwrite an active or completed send", () => {
  assert.deepEqual(
    effectiveStatus(
      { site: "claude", phase: "sending" },
      { site: "claude", phase: "loading" }
    ),
    { site: "claude", phase: "sending" }
  );
  assert.deepEqual(
    effectiveStatus(
      { site: "claude", phase: "warning", code: "tier_unconfirmed" },
      { site: "claude", phase: "ready" }
    ),
    { site: "claude", phase: "warning", code: "tier_unconfirmed" }
  );
});

test("a page crash overrides stale send state", () => {
  assert.deepEqual(
    effectiveStatus(
      { site: "claude", phase: "submitted" },
      { site: "claude", phase: "crashed", code: "renderer_crashed" }
    ),
    { site: "claude", phase: "crashed", code: "renderer_crashed" }
  );
});

test("only unseen terminal work is marked unread and visiting retains its phase", () => {
  assert.deepEqual(statusWithUnread({ site: "claude", phase: "complete" }, false), {
    site: "claude",
    phase: "complete",
    unread: true,
  });
  assert.deepEqual(statusWithUnread({ site: "claude", phase: "failed" }, true), {
    site: "claude",
    phase: "failed",
    unread: false,
  });
  assert.deepEqual(statusWithUnread({ site: "claude", phase: "generating" }, false), {
    site: "claude",
    phase: "generating",
  });
  assert.deepEqual(markStatusRead({ site: "claude", phase: "complete", unread: true }), {
    site: "claude",
    phase: "complete",
    unread: false,
  });
});

// F218：扩展↔Desktop 归档码双向对账。扩展端 no_window（尚未开窗）与 Desktop 端 no_view（视图已销毁/未打开）
// 语义相通，一份归档条目跨端同步后，两端都不能把对方的码兜底成笼统的「失败」。
test("collection code fallback recognizes both the extension's and Desktop's own window-unavailable codes", () => {
  const copy = getCopy("zh-CN");
  assert.equal(describeCollectionCode(copy, "no_view"), copy.siteUnavailable);
  assert.equal(describeCollectionCode(copy, "no_window"), copy.siteUnavailable);
});
