import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import test from "node:test";

import { SettingsWorkspace } from "../src/renderer/settings-workspace";
import { getCopy } from "../src/shared/copy";
import type { SyncStatus } from "../src/shared/sync";
import { readSource } from "./fixtures";

const noop = () => undefined;
const runtime = { version: "0.19.0", distribution: "installed" } as const;
const status = (patch: Partial<SyncStatus> = {}): SyncStatus => ({
  state: "idle",
  connected: false,
  pending: 2,
  errorCount: 0,
  readOnly: false,
  oauthConfigured: true,
  secureTokenStorage: true,
  ...patch
});

const renderSettings = (value: SyncStatus): string => renderToStaticMarkup(
  <SettingsWorkspace
    copy={getCopy("en")}
    locale="en"
    runtime={runtime}
    status={value}
    onStatus={noop}
    onAnnounce={noop}
    onClose={noop}
  />
);

test("settings identify the running version and portable profile", () => {
  const html = renderToStaticMarkup(
    <SettingsWorkspace
      copy={getCopy("zh-CN")}
      locale="zh-CN"
      runtime={{ version: "0.20.0", distribution: "portable" }}
      status={status()}
      onStatus={noop}
      onAnnounce={noop}
      onClose={noop}
    />
  );
  assert.match(html, /PolyAsk 0\.20\.0 · 便携版/);
});

test("idle Drive status distinguishes local-only data from an up-to-date connection", () => {
  const disconnected = renderSettings(status({ connected: false, state: "idle" }));
  assert.match(disconnected, /data-state="idle" data-connected="false"/);
  assert.match(disconnected, />Local only</);
  assert.doesNotMatch(disconnected, />Up to date</);
  assert.match(disconnected, /title="Close settings" aria-label="Close settings"/);
  assert.equal([...disconnected.matchAll(/aria-live="polite"/g)].length, 1);
  assert.equal([...disconnected.matchAll(/>Local only</g)].length, 1);
  assert.match(disconnected, /<div class="archive-status" role="status" aria-live="polite"><\/div>/);

  const connected = renderSettings(status({ connected: true, state: "idle" }));
  assert.match(connected, /data-state="idle" data-connected="true"/);
  assert.match(connected, />Up to date</);
  assert.doesNotMatch(connected, />Local only</);
  assert.equal([...connected.matchAll(/>Up to date</g)].length, 1);
  assert.equal([...connected.matchAll(/aria-live="polite"/g)].length, 1);
});

test("disconnected Drive keeps actionable states and reasons visible", () => {
  const states = [
    ["offline", "Offline · changes queued"],
    ["auth", "Sign in again to sync"],
    ["blocked", "Drive access blocked"],
    ["waiting", "Drive busy · retry scheduled"],
    ["schema", "Download only (update app to upload)"],
    ["error", "Sync failed"]
  ] as const;
  for (const [state, message] of states) {
    const html = renderSettings(status({ connected: false, state }));
    assert.match(html, new RegExp(`>${message.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}<`));
    assert.doesNotMatch(html, />Local only</);
  }

  const reason = renderSettings(status({ connected: false, state: "idle", reason: "oauth_not_configured" }));
  assert.match(reason, />OAuth credentials missing</);
  assert.doesNotMatch(reason, />Local only</);
});

test("syncing settings keep the exit available while freezing state-changing actions", () => {
  const html = renderSettings(status({ connected: true, state: "syncing" }));
  assert.doesNotMatch(html, /title="Close settings" aria-label="Close settings" disabled=""/);
  assert.match(html, /<button type="button" class="settings-control primary" disabled="">Syncing…<\/button>/);
  assert.match(html, /<button type="button" class="settings-control" disabled="">Disconnect<\/button>/);
});

test("waiting for browser authorization never traps the settings page", () => {
  const html = renderSettings(status({ connected: false, state: "syncing", reason: "oauth" }));
  assert.doesNotMatch(html, /aria-label="Close settings" disabled=""/);
  assert.match(html, />Waiting for browser authorization…</);
  const source = readSource("src/renderer/settings-workspace.tsx");
  assert.match(source, /event\.key === "Escape" && !closeLocked/);
  assert.match(source, /aria-label=\{props\.copy\.closeSettings\} disabled=\{closeLocked\}/);
});

test("background status pushes refresh diagnostics without stealing focus or reopening the panel", () => {
  const source = readSource("src/renderer/settings-workspace.tsx");
  assert.match(
    source,
    /useEffect\(\(\) => \{\s*setDiagnostics\(createSyncDiagnosticSnapshot\(props\.status, props\.runtime\)\);\s*\}, \[props\.runtime, props\.status\]\);/,
    "the status effect must only refresh data"
  );
  assert.match(source, /const pendingFocus = useRef\(false\);/);
  assert.match(source, /if \(!pendingFocus\.current\) return;/);
});

test("a stored authorization keeps a revoke action available while disconnected", () => {
  const stored = renderSettings(status({ connected: false, state: "auth", reason: "oauth_rejected", hasStoredToken: true }));
  assert.match(stored, />Revoke Google access</);
  assert.doesNotMatch(renderSettings(status({ connected: false, state: "idle" })), />Revoke Google access</);
});

test("sync settings expose compact connection state and protected cloud deletion", () => {
  const html = renderToStaticMarkup(
    <SettingsWorkspace
      copy={getCopy("zh-CN")}
      locale="zh-CN"
      runtime={runtime}
      status={status({ connected: true, state: "waiting" })}
      onStatus={noop}
      onAnnounce={noop}
      onClose={noop}
    />
  );
  assert.match(html, /Google Drive 同步/);
  assert.match(html, /已连接/);
  assert.match(html, /2 项待传/);
  assert.match(html, /立即同步/);
  assert.match(html, /断开连接/);
  assert.match(html, /输入 DELETE 解锁按钮/);
  assert.match(html, /<button[^>]*disabled=""[^>]*>删除云端数据<\/button>/);
  assert.match(html, /drive\.appdata/);
});

test("sync settings surfaces missing OAuth without irrelevant storage warnings", () => {
  const html = renderToStaticMarkup(
    <SettingsWorkspace
      copy={getCopy("en")}
      locale="en"
      runtime={runtime}
      status={status({ oauthConfigured: false, secureTokenStorage: false })}
      onStatus={noop}
      onAnnounce={noop}
      onClose={noop}
    />
  );
  assert.match(html, /no Google Desktop OAuth config/);
  assert.doesNotMatch(html, /System keyring is unavailable/);
  assert.match(html, /<button type="button" class="settings-control primary" disabled="">Connect Google Drive<\/button>/);
});

test("a configured Linux build reports insecure token storage", () => {
  const html = renderToStaticMarkup(
    <SettingsWorkspace copy={getCopy("en")} locale="en" runtime={runtime} status={status({ secureTokenStorage: false })} onStatus={noop} onAnnounce={noop} onClose={noop} />
  );
  assert.match(html, /System keyring is unavailable/);
});

test("an expired connected session offers reauthentication instead of a dead-end sync action", () => {
  const html = renderToStaticMarkup(
    <SettingsWorkspace
      copy={getCopy("en")}
      locale="en"
      runtime={runtime}
      status={status({ connected: true, state: "auth" })}
      onStatus={noop}
      onAnnounce={noop}
      onClose={noop}
    />
  );
  assert.match(html, /<strong>Sign in again<\/strong>/);
  assert.match(html, /class="settings-control primary"[^>]*>Reconnect<\/button>/);
  assert.match(html, /Disconnect/);
  assert.doesNotMatch(html, /class="settings-control primary"[^>]*>Sync now<\/button>/);
  assert.doesNotMatch(html, /<button type="button">Sync now<\/button>/);
});

test("Drive failure expands six-stage diagnostics with safe support actions", () => {
  const html = renderSettings(status({
    state: "blocked",
    reason: "oauth_invalid_client"
  }));
  assert.match(html, /aria-controls="sync-diagnostic-stages" aria-expanded="true"/);
  assert.equal([...html.matchAll(/data-diagnostic-stage=/g)].length, 6);
  assert.match(html, /data-diagnostic-stage="token-exchange" data-stage-state="failed"/);
  assert.match(html, />Connection diagnostics</);
  assert.match(html, />Copy diagnostic report</);
  assert.match(html, />Recheck</);
});

test("Drive diagnostics command opens the healthy six-stage section on demand", () => {
  const html = renderToStaticMarkup(
    <SettingsWorkspace
      copy={getCopy("zh-CN")}
      locale="zh-CN"
      runtime={runtime}
      status={status({ connected: true, lastSuccessAt: 2_000 })}
      initialSection="drive-diagnostics"
      onStatus={noop}
      onAnnounce={noop}
      onClose={noop}
    />
  );
  assert.match(html, /aria-controls="sync-diagnostic-stages" aria-expanded="true"/);
  assert.equal([...html.matchAll(/data-diagnostic-stage=/g)].length, 6);
  assert.match(html, />连接诊断</);
  assert.match(html, /仅含连接状态/);
});

test("settings expose an explicit local-only completion notification preference", () => {
  const html = renderToStaticMarkup(
    <SettingsWorkspace
      copy={getCopy("zh-CN")}
      locale="zh-CN"
      runtime={runtime}
      status={status()}
      completionNotifications={true}
      onCompletionNotificationsChange={noop}
      onCheckUpdates={noop}
      onStatus={noop}
      onAnnounce={noop}
      onClose={noop}
    />
  );
  assert.match(html, /后台完成通知/);
  assert.match(html, /checked=""/);
  assert.match(html, /仅存本机/);
  assert.match(html.match(/<input[^>]*name="completion-notifications"[^>]*>/)?.[0] ?? '', /aria-labelledby="completion-notifications-title"/);
  assert.match(html, /aria-describedby="notification-test-status"[^>]*>发送测试通知</);
  assert.match(html, /版本更新/);
  assert.match(html, />查看最新版本</);
});

test("settings restore confirmations that were turned off with don't ask again", () => {
  const render = (confirmations: { sitePageCloseConfirm: boolean; newSessionConfirm: boolean }) => renderToStaticMarkup(
    <SettingsWorkspace copy={getCopy("zh-CN")} locale="zh-CN" runtime={runtime} status={status()}
      confirmations={confirmations} onConfirmationChange={noop}
      onStatus={noop} onAnnounce={noop} onClose={noop} />
  );
  const html = render({ sitePageCloseConfirm: false, newSessionConfirm: true });
  assert.match(html, /确认提示/);
  assert.match(html, /data-settings-section="interaction"/);
  assert.match(html, /关闭站点页面前确认/);
  assert.match(html, /正在发送、回答或存副本的页面仍会受保护/);
  assert.match(html, /开启新会话前确认/);
  assert.doesNotMatch(html, /name="confirmation-sitePageCloseConfirm"[^>]*checked/);
  assert.match(html, /name="confirmation-newSessionConfirm"[^>]*checked=""/);
  assert.doesNotMatch(renderToStaticMarkup(<SettingsWorkspace copy={getCopy("zh-CN")} locale="zh-CN" runtime={runtime}
    status={status()} onStatus={noop} onAnnounce={noop} onClose={noop} />), /settings-confirmations/);
});

test("settings expose the three local-data entry points and promise cloud data stays", () => {
  const html = renderSettings(status({ connected: true, state: "idle" }));
  assert.match(html, /aria-labelledby="local-data-title"/);
  for (const label of ["Clear question history", "Clear result library", "Reset all local data"]) {
    assert.match(html, new RegExp(`<button[^>]*>${label}</button>`));
  }
  assert.match(html, /Resetting keeps Google Drive files/);
  assert.doesNotMatch(html, /confirm-dialog/, "未点击前不得出现确认层");
  const syncing = renderSettings(status({ connected: true, state: "syncing" }));
  assert.match(syncing, /<button[^>]*disabled=""[^>]*>Reset all local data<\/button>/);
});

test("cloud deletion explains disconnected, reauthentication and busy states before confirmation", () => {
  for (const [patch, expected] of [
    [{ connected: false }, "Connect Google Drive before deleting cloud data."],
    [{ connected: true, state: "auth" }, "Sign in again to sync"],
    [{ connected: true, state: "syncing" }, "Wait for the current action to finish."],
    [{ connected: true }, "Type DELETE to unlock"]
  ] as const) {
    const html = renderSettings(status(patch));
    assert.ok(html.includes(`id="cloud-clear-hint" class="settings-control-hint">${expected}</p>`));
    assert.match(html, /aria-describedby="cloud-clear-hint" disabled=""/);
  }
});
