import assert from "node:assert/strict";
import test from "node:test";

import type { ProxySecretStateView } from "../src/shared/proxy-state";
import { buildSiteReport, REPORT_PROXY_SECRET_STATES } from "../src/shared/site-report";

test("the site diagnostic report carries environment, per-site state and every check without content", () => {
  const report = buildSiteReport({
    version: "1.0.0",
    distribution: "portable",
    platform: "Win32",
    scale: 1.25,
    sites: [{ key: "claude", label: "Claude" }, { key: "kimi", label: "Kimi" }],
    statuses: { claude: { site: "claude", phase: "failed", code: "composer_not_found" } },
    health: {
      claude: {
        site: "claude", state: "error", checkedAt: Date.UTC(2026, 8, 5, 3, 0, 0),
        checks: [{ name: "输入框", ok: false, kind: "reach" }, { name: "模型入口", ok: true, kind: "control" }, { name: "当前档位", ok: false, kind: "tier" }]
      }
    },
    now: Date.UTC(2026, 8, 5, 3, 1, 0)
  });
  const lines = report.split("\n");
  assert.equal(lines[0], "PolyAsk Desktop 1.0.0 (portable) · Win32 · scale 1.25");
  assert.equal(lines[1], "generated 2026-09-05T03:01:00.000Z");
  assert.equal(lines[2], "[claude] Claude: phase=failed code=composer_not_found health=error checkedAt=2026-09-05T03:00:00.000Z");
  assert.deepEqual(lines.slice(3, 6), ["  - 输入框 kind=reach ok=false", "  - 模型入口 kind=control ok=true", "  - 当前档位 kind=tier ok=false"]);
  assert.equal(lines[6], "[kimi] Kimi: phase=unknown health=unknown");
  assert.equal(lines[7], "  - (no checks)");
  assert.doesNotMatch(report, /https?:\/\//, "报告不得包含 URL");
});

test("copied diagnostics include only normalized runtime process failure fields", () => {
  const report = buildSiteReport({ version: "1.10.1", distribution: "installed", platform: "Win32", scale: 1,
    sites: [], statuses: {}, health: {}, now: 0,
    processFailures: [{ processType: "GPU", reason: "launch-failed", exitCode: 5, systemErrorCode: 5,
      name: "private account", path: "/private", url: "https://private.invalid" },
      { processType: "https://private.invalid", reason: "crashed" }] } as any);
  assert.match(report, /runtime \[GPU\]: reason=launch-failed exitCode=5 systemErrorCode=5/);
  assert.doesNotMatch(report, /private|https|name=|path=/);
});

const BASE = { version: "1.20.0", distribution: "installed", platform: "Win32", scale: 1,
  sites: [], statuses: {}, health: {}, now: Date.UTC(2026, 9, 12, 0, 0, 0) } as const;

function proxyState(overrides: Record<string, unknown> = {}) {
  return {
    applied: { version: 1, mode: "custom", scheme: "http", host: "proxy.corp-secret.example", port: 3128,
      bypass: ["*.intranet-secret.example", "10.0.0.0/8"], username: "alice-secret" },
    blocked: false,
    stored: "ok",
    appliedResult: "ok",
    pending: false,
    pendingConfirm: null,
    following: false,
    formValue: { version: 1, mode: "custom", scheme: "http", host: "proxy.corp-secret.example", port: 3128,
      bypass: ["*.intranet-secret.example", "10.0.0.0/8"], username: "alice-secret" },
    secret: "saved",
    encryption: true,
    linuxDesktopProxy: null,
    ...overrides
  };
}

test("the report header carries one enum-only proxy line without host, port, user or bypass", () => {
  const report = buildSiteReport({ ...BASE, proxy: proxyState() });
  const lines = report.split("\n");
  assert.equal(lines[1], "generated 2026-10-12T00:00:00.000Z");
  assert.equal(lines[2], "proxy mode=custom scheme=http auth=yes secret=saved following=no applied=ok pending=no confirm=no stored=ok");
  assert.doesNotMatch(report, /secret\.example|corp-secret|intranet|alice|3128|10\.0\.0\.0/, "报告不得包含主机、端口、用户名或绕过列表");

  const socks = buildSiteReport({ ...BASE, proxy: proxyState({
    formValue: { version: 1, mode: "custom", scheme: "socks5", host: "127.0.0.1", port: 1080, bypass: [], username: "" },
    secret: "none", following: true }) });
  assert.equal(socks.split("\n")[2], "proxy mode=custom scheme=socks5 auth=no secret=none following=yes applied=ok pending=no confirm=no stored=ok");
  assert.doesNotMatch(socks, /127\.0\.0\.1|1080/);
});

test("non-custom modes omit scheme and failure, pending and confirm states are reported as enums", () => {
  const report = buildSiteReport({ ...BASE, proxy: proxyState({
    applied: null, blocked: true, stored: "invalid", appliedResult: "proxy_apply_failed", pending: true,
    pendingConfirm: { scheme: "http", host: "synced-secret.example", port: 8080, version: { updatedAt: 5, deviceId: "device-secret" } },
    following: true, secret: "unreadable",
    formValue: { version: 1, mode: "system", scheme: "http", host: "", port: 0, bypass: [], username: "" } }) });
  assert.equal(report.split("\n")[2],
    "proxy mode=system auth=no secret=unreadable following=yes applied=proxy_apply_failed pending=yes confirm=yes stored=invalid");
  assert.doesNotMatch(report, /synced-secret|8080|device-secret|scheme=/, "待确认项只报告有无，不报告内容");

  const direct = buildSiteReport({ ...BASE, proxy: proxyState({
    formValue: { version: 1, mode: "direct", scheme: "http", host: "", port: 0, bypass: [], username: "" }, secret: "unknown" }) });
  assert.equal(direct.split("\n")[2], "proxy mode=direct auth=no secret=unknown following=no applied=ok pending=no confirm=no stored=ok");
});

test("dirty proxy input is dropped field by field and the line disappears without a valid mode", () => {
  const dirty = buildSiteReport({ ...BASE, proxy: {
    formValue: { mode: "custom", scheme: "ftp://private.invalid", username: 7, host: "private.invalid" },
    following: "yes", appliedResult: "proxy_failed https://private.invalid", stored: "corrupt", pending: 1,
    pendingConfirm: "private.invalid:8080", secret: "hunter2" } as never });
  assert.equal(dirty.split("\n")[2], "proxy mode=custom");
  assert.doesNotMatch(dirty, /private|hunter2|ftp|8080|proxy_failed/);

  for (const proxy of ["custom", 42, null, [], { formValue: null }, { formValue: "custom" },
    { formValue: { mode: "https://private.invalid" }, secret: "saved" }, { secret: "saved", following: true }]) {
    const report = buildSiteReport({ ...BASE, proxy: proxy as never });
    assert.doesNotMatch(report, /^proxy /m, `脏输入 ${JSON.stringify(proxy)} 不应产生 proxy 行`);
    assert.doesNotMatch(report, /private/);
  }
  assert.doesNotMatch(buildSiteReport(BASE), /^proxy /m, "没有 proxy 输入时不输出该行");
});

test("the report's secret-state whitelist matches ProxySecretStateView exactly", () => {
  const every = { unknown: true, saved: true, memory: true, mismatch: true, unreadable: true, none: true } satisfies Record<ProxySecretStateView, true>;
  assert.deepEqual([...REPORT_PROXY_SECRET_STATES].sort(), Object.keys(every).sort());
});
