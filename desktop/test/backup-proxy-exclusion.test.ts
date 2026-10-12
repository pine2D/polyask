import assert from "node:assert/strict";
import test from "node:test";
import { BackupService } from "../src/main/backup-service";
import { isBackupPreferenceKey, validateBackup } from "../src/main/backup-validation";
import { DesktopDatabase } from "../src/main/database";
import { isVersionedPreference } from "../src/shared/preferences";
import { DEFAULT_PROXY_PREFERENCE, isProxyPreference, type ProxyPreference } from "../src/shared/proxy-preference";

// 展开默认值后，字段仍按规范顺序排列（version, mode, scheme, host, port, bypass, username），所以 isProxyPreference 能接受。
const PROXY: ProxyPreference = { ...DEFAULT_PROXY_PREFERENCE, mode: "custom", host: "proxy.example.com", port: 8080, username: "alice" };
const OTHER_PROXY: ProxyPreference = { ...DEFAULT_PROXY_PREFERENCE, mode: "custom", host: "other.example.net", port: 3128 };
const versioned = (value: unknown, updatedAt: number, deviceId: string) => ({ value, updatedAt, deviceId });
const doc = (entries: unknown[]) => ({ format: "polyask-backup", version: 3, exportedAt: 20, entries });
const density = { kind: "preference", id: "density", body: { value: "compact", updatedAt: 10 } };
const proxyEntry = { kind: "preference", id: "proxy", body: { value: PROXY, updatedAt: 10 } };

test("fixture proxy value is a valid versioned preference, so rejection below comes from the backup exclusion", () => {
  assert.equal(isProxyPreference(PROXY), true);
  assert.equal(isProxyPreference(OTHER_PROXY), true);
  assert.equal(isVersionedPreference("proxy", versioned(PROXY, 10, "backup")), true);
  assert.equal(isBackupPreferenceKey("proxy"), false);
  assert.equal(isBackupPreferenceKey("density"), true);
  assert.equal(isBackupPreferenceKey("siteZoom.kimi"), true);
  assert.equal(isBackupPreferenceKey("nonsense"), false);
});

test("export skips preference:proxy and never carries proxy meta, whether or not the device follows", () => {
  const db = DesktopDatabase.open(":memory:");
  try {
    db.meta.put("deviceId", "local");
    db.meta.put("proxyFollowing", true);
    db.meta.put("proxyOverride", OTHER_PROXY);
    db.meta.put("proxyAccepted", PROXY);
    db.state.put("preference:density", versioned("compact", 10, "local"), 10, false);
    db.state.put("preference:proxy", versioned(PROXY, 11, "other-device"), 11, false);
    const exported = new BackupService(db, { deviceId: () => "local", now: () => 100 }).export();
    assert.deepEqual(exported.entries.map(e => `${e.kind}:${e.id}`), ["preference:density"]);
    const text = JSON.stringify(exported);
    assert.equal(text.includes("proxy"), false, "no proxy key, meta key name or value in export");
    assert.equal(text.includes("example.com"), false);
    assert.equal(text.includes("alice"), false);
  } finally { db.close(); }
});

test("validation rejects any backup document that contains a proxy preference entry", () => {
  assert.equal(validateBackup(doc([density])).entries.length, 1, "control document without proxy is accepted");
  assert.throws(() => validateBackup(doc([proxyEntry])), /backup_invalid/);
  assert.throws(() => validateBackup(doc([density, proxyEntry])), /backup_invalid/);
  const db = DesktopDatabase.open(":memory:");
  try {
    const service = new BackupService(db, { deviceId: () => "local", now: () => 100 });
    assert.throws(() => service.preview(doc([density, proxyEntry])), /backup_invalid/);
    assert.equal(db.state.get("preference:proxy"), null);
    assert.equal(db.outbox.ready(0).length, 0);
  } finally { db.close(); }
});

test("restore leaves the local proxy alone and a proxy sync between preview and apply does not stale the plan", () => {
  const source = DesktopDatabase.open(":memory:"), target = DesktopDatabase.open(":memory:");
  try {
    source.state.put("preference:density", versioned("compact", 10, "source"), 10, false);
    source.state.put("preference:proxy", versioned(PROXY, 11, "source"), 11, false);
    const exported = new BackupService(source, { deviceId: () => "source", now: () => 100 }).export();
    target.state.put("preference:proxy", versioned(OTHER_PROXY, 50, "peer"), 50, false);
    const service = new BackupService(target, { deviceId: () => "target", now: () => 600 });
    const preview = service.preview(exported);
    assert.deepEqual(preview.items.map(i => i.key), ["preference:density"]);
    // 模拟同步拉取在预览与导入之间改写了代理：代理不在快照里，所以指纹不变。
    target.state.put("preference:proxy", versioned(PROXY, 700, "peer"), 700, false);
    assert.deepEqual(service.apply(preview.token, ["preference:density"]), { imported: 1, skipped: 0 });
    assert.deepEqual(target.state.get("preference:proxy"), versioned(PROXY, 700, "peer"));
    assert.deepEqual(target.outbox.ready(0).map(v => v.key), ["state:preference:density"]);
  } finally { source.close(); target.close(); }
});
