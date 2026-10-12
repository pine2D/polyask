import assert from "node:assert/strict";
import test from "node:test";

import { completeRun, failedRunSites, retryRequest, uncertainRunSites } from "../src/renderer/broadcast-run";
import { pageSiteDetail } from "../src/renderer/page-submission";
import { siteRecoveryAdvice } from "../src/renderer/site-health-recovery";
import { getCopy } from "../src/shared/copy";
import { PAGE_LOAD_FAILURE_CODES, isPageLoadFailure, type BroadcastRequest, type SiteStatus } from "../src/shared/protocol";
import type { SiteHealth } from "../src/shared/site-health";

const request: BroadcastRequest = {
  runId: "run-proxy", text: "compare", tier: null, images: [],
  sites: ["claude", "chatgpt", "kimi", "gemini", "deepseek"]
};

test("page-load failures cover plain and proxy failures and nothing that might have been sent", () => {
  assert.deepEqual([...PAGE_LOAD_FAILURE_CODES].sort(), ["load_failed", "proxy_auth_failed", "proxy_failed"]);
  for (const code of PAGE_LOAD_FAILURE_CODES) assert.equal(isPageLoadFailure(code), true, code);
  for (const code of ["submit_unconfirmed", "timeout", "cancelled", "renderer_crashed", "proxy_error", "proxy_apply_failed", "", undefined]) {
    assert.equal(isPageLoadFailure(code), false, String(code));
  }
});

// spec §5.1 回归：代理失败的站点在重试审阅里归为「提交前失败」——默认重试带上它，不需要逐站确认。
test("retry review classifies proxy failures as pre-submit failures, not uncertain outcomes", () => {
  const run = completeRun(request, [
    { site: "claude", ok: false, code: "proxy_failed" },
    { site: "chatgpt", ok: false, code: "proxy_auth_failed" },
    { site: "kimi", ok: false, code: "submit_unconfirmed" },
    { site: "gemini", ok: false, code: "load_failed" },
    { site: "deepseek", ok: true }
  ]);
  assert.deepEqual(failedRunSites(run), ["claude", "chatgpt", "gemini"]);
  assert.deepEqual(uncertainRunSites(run), ["kimi"], "only the possibly-sent site needs review");
  assert.deepEqual(retryRequest(run)?.sites, ["claude", "chatgpt", "gemini"]);
  assert.deepEqual(retryRequest(run, "claude")?.sites, ["claude"]);
  assert.equal(retryRequest(run, "kimi"), null, "an uncertain site still needs explicit confirmation");
});

test("page detail names the proxy failure the same way it names a load failure", () => {
  for (const locale of ["en", "zh-CN", "zh-TW"]) {
    const copy = getCopy(locale);
    const failed = (code: string): SiteStatus => ({ site: "claude", phase: "failed", code });
    assert.equal(pageSiteDetail("Claude", failed("proxy_failed"), copy), `Claude: ${copy.sitePageNotSent} · ${copy.proxyFailed}`, locale);
    assert.equal(pageSiteDetail("Claude", failed("proxy_auth_failed"), copy), `Claude: ${copy.sitePageNotSent} · ${copy.proxyAuthFailed}`, locale);
    assert.equal(pageSiteDetail("Claude", failed("load_failed"), copy), `Claude: ${copy.sitePageNotSent} · ${copy.loadFailed}`, locale);
  }
});

test("site health recovery suggests reloading a page that failed through the proxy", () => {
  const health = (patch: Partial<SiteHealth> = {}): SiteHealth =>
    ({ site: "claude", state: "ready", page: "ready", checks: [{ name: "Reach", kind: "reach", ok: true }], ...patch });
  const page = { reason: "page", action: "reload", advisory: false };
  assert.deepEqual(siteRecoveryAdvice(health(), { site: "claude", phase: "failed", code: "proxy_failed" }), page);
  assert.deepEqual(siteRecoveryAdvice(health(), { site: "claude", phase: "failed", code: "proxy_auth_failed" }), page);
  assert.deepEqual(siteRecoveryAdvice(health({ recent: { phase: "failed", code: "proxy_failed" } }), { site: "claude", phase: "ready" }), page);
});
