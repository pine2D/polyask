import assert from "node:assert/strict";
import test from "node:test";

import { DesktopDatabase } from "../src/main/database";
import { SyncEngine, type SyncAuth, type SyncDrive } from "../src/main/sync-engine";
import { classifySyncFailure } from "../src/main/sync-failures";
import { SyncRepository } from "../src/main/sync-repository";
import { describeSync } from "../src/renderer/sync-status";
import { COPY } from "../src/shared/copy";
import type { SyncStatus } from "../src/shared/sync";
import {
  buildSyncDiagnosticReport,
  createSyncDiagnosticSnapshot,
  firstFailedSyncStage
} from "../src/shared/sync-diagnostics";

const proxyFailure = () => Object.assign(new Error("proxy_error"), { code: "proxy_error", status: 0 });
const status = (patch: Partial<SyncStatus> = {}): SyncStatus => ({
  state: "offline",
  connected: false,
  pending: 0,
  errorCount: 0,
  readOnly: false,
  oauthConfigured: true,
  secureTokenStorage: true,
  ...patch
});
const runtime = { version: "1.19.0", distribution: "installed" } as const;
const idleAuth = (): SyncAuth => ({
  configured: () => true,
  securePersistence: () => true,
  connect: async () => undefined,
  disconnect: async () => undefined
});

test("proxy_error is an offline failure attributed to the stage that went through the proxy", () => {
  assert.deepEqual(classifySyncFailure(new Error("proxy_error"), "oauth"), { state: "offline", reason: "oauth_proxy" });
  assert.deepEqual(classifySyncFailure(proxyFailure(), "drive"), { state: "offline", reason: "drive_proxy" });
  assert.deepEqual(classifySyncFailure({ code: "proxy_error" }, "sync"), { state: "offline", reason: "drive_proxy" });
  // 非代理的传输失败保持原有 reason。
  assert.deepEqual(classifySyncFailure(new Error("network_error"), "oauth"), { state: "offline", reason: "oauth_network" });
  assert.deepEqual(classifySyncFailure({ code: "network_error" }, "drive"), { state: "offline", reason: "drive_network" });
  assert.deepEqual(classifySyncFailure({ code: "network_error" }, "sync"), { state: "offline" });
});

test("diagnostics keep the proxy reasons and point at the stage that failed", () => {
  const oauth = createSyncDiagnosticSnapshot(status({ reason: "oauth_proxy" }), runtime, 3_000);
  assert.equal(oauth.reason, "oauth_proxy");
  assert.equal(firstFailedSyncStage(oauth)?.id, "token-exchange");
  assert.equal(firstFailedSyncStage(oauth)?.code, "oauth_proxy");

  const drive = createSyncDiagnosticSnapshot(status({ connected: true, reason: "drive_proxy" }), runtime, 3_000);
  assert.equal(drive.reason, "drive_proxy");
  assert.equal(firstFailedSyncStage(drive)?.id, "drive-access");
  assert.equal(firstFailedSyncStage(drive)?.code, "drive_proxy");
  assert.match(buildSyncDiagnosticReport(drive), /^reason=drive_proxy$/m);
});

test("the proxy reasons have their own copy in every locale", () => {
  for (const copy of [COPY.en, COPY.zhCN, COPY.zhTW]) {
    assert.equal(describeSync(copy, status({ reason: "oauth_proxy" })), copy.syncReasonOauthProxy);
    assert.equal(describeSync(copy, status({ reason: "drive_proxy" })), copy.syncReasonDriveProxy);
    assert.notEqual(copy.syncReasonOauthProxy, copy.syncReasonOauthNetwork);
    assert.notEqual(copy.syncReasonDriveProxy, copy.syncReasonDriveNetwork);
  }
  assert.deepEqual(
    [COPY.en.syncReasonDriveProxy, COPY.zhCN.syncReasonDriveProxy, COPY.zhTW.syncReasonDriveProxy],
    [
      "PolyAsk could not reach Google Drive through the proxy. Check the proxy settings, then try again.",
      "PolyAsk 无法通过代理连接 Google Drive。请检查代理设置后重试。",
      "PolyAsk 無法透過代理連線至 Google Drive。請檢查代理設定後再試一次。"
    ]
  );
  assert.deepEqual(
    [COPY.en.syncReasonOauthProxy, COPY.zhCN.syncReasonOauthProxy, COPY.zhTW.syncReasonOauthProxy],
    [
      "Browser authorization completed, but PolyAsk could not reach Google sign-in services through the proxy. Check the proxy settings, then try again.",
      "浏览器授权已完成，但 PolyAsk 无法通过代理连接 Google 登录服务。请检查代理设置后重试。",
      "瀏覽器授權已完成，但 PolyAsk 無法透過代理連線至 Google 登入服務。請檢查代理設定後再試一次。"
    ]
  );
});

test("connecting through a failing proxy names the proxy at the right stage", async () => {
  for (const scenario of [{ where: "oauth", reason: "oauth_proxy" }, { where: "drive", reason: "drive_proxy" }] as const) {
    const database = DesktopDatabase.open(":memory:");
    database.meta.put("deviceId", "desktop-device");
    const repository = new SyncRepository(database);
    const auth: SyncAuth = {
      ...idleAuth(),
      connect: async () => { if (scenario.where === "oauth") throw new Error("proxy_error"); }
    };
    const drive: SyncDrive = {
      getStartToken: async () => {
        if (scenario.where === "drive") throw proxyFailure();
        return "start";
      },
      listFiles: async () => [],
      listChanges: async () => ({ changes: [], newStartPageToken: "next" }),
      download: async () => null,
      upsert: async (_id, name, appProperties) => ({ id: `uploaded-${name}`, appProperties }),
      clearAll: async () => undefined
    };
    try {
      const result = await new SyncEngine({ repository, drive, auth }).connect();
      assert.equal(result.state, "offline", scenario.where);
      assert.equal(result.reason, scenario.reason);
    } finally { database.close(); }
  }
});

test("a proxy failure during background sync backs off like any network failure", async () => {
  const database = DesktopDatabase.open(":memory:");
  database.meta.put("deviceId", "desktop-device");
  const repository = new SyncRepository(database);
  repository.saveConfig({ connected: true });
  let calls = 0;
  const fail = async (): Promise<never> => { calls += 1; throw proxyFailure(); };
  const drive: SyncDrive = { getStartToken: fail, listFiles: fail, listChanges: fail, download: fail, upsert: fail, clearAll: fail };
  const engine = new SyncEngine({ repository, drive, auth: idleAuth(), now: () => 10_000 });
  try {
    const first = await engine.syncNow("periodic");
    assert.equal(first.state, "offline");
    assert.equal(first.reason, "drive_proxy");
    assert.equal(calls, 1);
    await engine.syncNow("periodic");
    assert.equal(calls, 1, "proxy_error must arm the run backoff instead of hitting a dead proxy again");
  } finally { database.close(); }
});
