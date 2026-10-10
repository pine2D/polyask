import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { syncOverview } from "../src/renderer/sync-overview";
import { SyncDiagnosticsPanel } from "../src/renderer/sync-diagnostics-panel";
import { getCopy } from "../src/shared/copy";
import { buildSyncDiagnosticReport, createSyncDiagnosticSnapshot } from "../src/shared/sync-diagnostics";
import type { SyncStatus } from "../src/shared/sync";

const base: SyncStatus = { state: "idle", connected: true, pending: 0, errorCount: 0, readOnly: false, oauthConfigured: true, secureTokenStorage: true };
const status = (patch: Partial<SyncStatus>): SyncStatus => ({ ...base, ...patch });

for (const locale of ["en", "zh-CN", "zh-TW"] as const) test(`${locale}: one conclusion and one primary action per sync state`, () => {
  const copy = getCopy(locale);
  const timeout = syncOverview(copy, status({ state: "offline", reason: "oauth_callback_timeout" }));
  assert.equal(timeout.title, copy.syncNeedsReauth, "a connected device whose authorization timed out must not claim to be connected");
  assert.equal(timeout.primary, "reconnect");
  assert.equal(timeout.primaryLabel, copy.syncReconnect);
  assert.equal(timeout.detail, copy.syncReasonOauthCallbackTimeout);
  assert.equal(syncOverview(copy, status({ state: "auth" })).primary, "reconnect");
  assert.equal(syncOverview(copy, status({ state: "auth", reason: "drive_unauthorized" })).primary, "reconnect");
  const idle = syncOverview(copy, base);
  assert.deepEqual([idle.title, idle.tone, idle.primary, idle.primaryLabel], [copy.syncConnected, "ok", "sync", copy.syncNow]);
  const waiting = syncOverview(copy, status({ state: "waiting" }));
  assert.deepEqual([waiting.title, waiting.tone, waiting.primary], [copy.syncConnected, "attention", "sync"]);
  const failed = syncOverview(copy, status({ state: "error" }));
  assert.deepEqual([failed.title, failed.tone, failed.primaryLabel], [copy.syncNeedsAttention, "error", copy.syncRetry]);
  const misconfigured = syncOverview(copy, status({ state: "blocked", reason: "oauth_invalid_client" }));
  assert.notEqual(misconfigured.primary, "reconnect", "reauthorizing cannot fix a broken OAuth client");
  const off = syncOverview(copy, status({ connected: false }));
  assert.deepEqual([off.title, off.tone, off.primary, off.primaryLabel], [copy.syncDisconnected, "off", "connect", copy.syncConnect], "success colour needs an active connection");
  for (const overview of [timeout, idle, waiting, failed, misconfigured, off]) {
    assert.doesNotMatch(`${overview.title} ${overview.detail} ${overview.primaryLabel}`, /oauth_|drive_|_timeout/, "raw reason codes stay out of the card");
  }
});

test("diagnostic cards hide raw codes that remain in the copied report", () => {
  const snapshot = createSyncDiagnosticSnapshot(status({ state: "offline", reason: "oauth_callback_timeout" }), { version: "1.0.0", distribution: "installed" });
  assert.ok(snapshot.stages.some(stage => stage.code === "oauth_callback_timeout"));
  const html = renderToStaticMarkup(<SyncDiagnosticsPanel copy={getCopy("en")} snapshot={snapshot} open busy={false} canSync
    onOpenChange={() => undefined} onCopy={() => undefined} onRefresh={() => undefined} onSync={() => undefined} />);
  assert.doesNotMatch(html, /oauth_callback_timeout|<code/);
  assert.match(buildSyncDiagnosticReport(snapshot), /\(oauth_callback_timeout\)/);
});
