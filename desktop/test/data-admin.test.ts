import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { DataAdminService } from "../src/main/data-admin-service";
import { DesktopDatabase } from "../src/main/database";
import { HistoryService } from "../src/main/history-service";
import type { SyncStatus } from "../src/shared/sync";
import { SecretFileStore } from "../src/main/secret-file-store";
import { archiveFixture } from "./fixtures";

const status = (patch: Partial<SyncStatus> = {}): SyncStatus => ({
  state: "idle", connected: false, pending: 0, errorCount: 0, readOnly: false, oauthConfigured: true, secureTokenStorage: true, ...patch
});

function seeded(path: string): DesktopDatabase {
  const database = DesktopDatabase.open(path);
  database.meta.put("deviceId", "device-a");
  const history = new HistoryService(database.history, { deviceId: () => "device-a", now: () => 1_000 });
  history.record("first question");
  history.record("second question");
  database.archives.put(archiveFixture());
  database.archives.put({ ...archiveFixture(), id: "archive-b" });
  return database;
}

function rows(path: string, table: string): { id: string; deleted_at: number | null }[] {
  const raw = new DatabaseSync(path);
  try { return raw.prepare(`SELECT id, deleted_at FROM ${table} ORDER BY id`).all() as { id: string; deleted_at: number | null }[]; }
  finally { raw.close(); }
}

test("clearing history and result library tombstones every row and queues the deletions", () => {
  // CLAUDE.md「删除一律 tombstone」在 Desktop 侧的第一份测试：行还在、deleted_at 非空、outbox 有对应行。
  const directory = mkdtempSync(join(tmpdir(), "polyask-data-admin-"));
  const path = join(directory, "polyask.sqlite");
  try {
    const database = seeded(path);
    const before = database.outbox.count();
    const admin = new DataAdminService({
      database, deviceId: () => "device-a", now: () => 5_000,
      sync: { disconnect: async () => status(), status: () => status() }
    });
    assert.equal(admin.clearHistory(), 2);
    assert.equal(admin.clearArchives(), 2);
    assert.deepEqual(database.history.list(), []);
    assert.deepEqual(database.archives.list(), []);
    database.close();
    for (const table of ["history", "archives"]) {
      const stored = rows(path, table);
      assert.equal(stored.length, 2, `${table} 的行必须仍在（tombstone，不物理删）`);
      assert.ok(stored.every((row) => row.deleted_at === 5_000), `${table} 每行 deleted_at 必须非空`);
    }
    const reopened = DesktopDatabase.open(path);
    assert.ok(reopened.outbox.count() >= before, "每条 tombstone 都要进 outbox，删除才会同步到其它设备");
    assert.deepEqual(reopened.outbox.ready(0).filter((op) => op.kind === "archive").map((op) => op.key).sort(), ["archive:archive-a", "archive:archive-b"]);
    assert.equal(reopened.outbox.ready(0).filter((op) => op.kind === "history").length, 2);
    reopened.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("resetting local data disconnects first, wipes only this device, and keeps the device id", async () => {
  const database = seeded(":memory:");
  database.state.put("workspace", { selectedSites: ["claude"], tier: "think", updatedAt: 1, deviceId: "device-a" }, 1);
  database.state.put("group:g", { id: "g", name: "G", sites: ["claude"], updatedAt: 1, deviceId: "device-a" }, 1);
  database.meta.put("syncConfig", { connected: true, state: "idle" });
  database.driveFiles.put({ id: "f", name: "n", appProperties: {}, logicalKey: "archive:archive-a", seenAt: 1 });
  const events: string[] = [];
  const admin = new DataAdminService({
    database, deviceId: () => "device-a",
    beforeDisconnect: () => { events.push(`cancel:rows=${database.archives.list().length}`); },
    beforeWipe: () => { events.push(`runtime:rows=${database.archives.list().length}`); },
    sync: {
      disconnect: async () => { events.push(`disconnect:rows=${database.archives.list().length}`); return status(); },
      status: () => status({ connected: false })
    }
  });
  try {
    const result = await admin.resetLocal();
    assert.deepEqual(events, ["cancel:rows=2", "disconnect:rows=2", "runtime:rows=2"], "须先停止发送，再断开云端、失效旧运行态，最后清库");
    assert.equal(result.connected, false);
    assert.equal(database.history.list().length, 0);
    assert.equal(database.archives.list().length, 0);
    assert.equal(database.archives.get("archive-a"), null, "重置是本机物理清空，不是 tombstone——tombstone 会在重新连接后赢过云端副本并把云端也删掉");
    assert.equal(database.state.get("workspace"), null);
    assert.equal(database.state.list("group:").length, 0);
    assert.equal(database.outbox.count(), 0);
    assert.equal(database.driveFiles.list().length, 0);
    assert.equal(database.meta.get("syncConfig"), null);
    assert.equal(database.meta.get("deviceId"), "device-a", "deviceId 保留：重连后据此继承本机在云端的旧设置键");
  } finally { database.close(); }
});

test("local reset truncates WAL pages containing deleted answer text before returning", () => {
  const directory = mkdtempSync(join(tmpdir(), "polyask-reset-wal-"));
  const path = join(directory, "polyask.sqlite");
  const marker = "RESET_WAL_SYNTHETIC_SECRET_2026";
  const database = DesktopDatabase.open(path);
  try {
    new HistoryService(database.history, { deviceId: () => "device-a" }).record(marker);
    assert.equal(readFileSync(`${path}-wal`).includes(marker), true);
    database.resetLocalData();
    assert.equal(database.history.list().length, 0);
    assert.equal(readFileSync(path).includes(marker), false);
    assert.equal(existsSync(`${path}-wal`) && readFileSync(`${path}-wal`).includes(marker), false);
  } finally { database.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("a local reset remains exclusive while Drive disconnect is pending", async () => {
  const database = seeded(":memory:");
  let finish!: () => void;
  let disconnects = 0;
  const admin = new DataAdminService({ database, deviceId: () => "device-a",
    sync: { disconnect: () => { disconnects++; return new Promise<SyncStatus>(resolve => { finish = () => resolve(status()); }); },
      status: () => status() } });
  try {
    const first = admin.resetLocal();
    assert.equal(admin.isResetting, true);
    await assert.rejects(admin.resetLocal(), /operation_busy/);
    assert.equal(disconnects, 1);
    finish();
    await first;
    assert.equal(admin.isResetting, false);
  } finally { database.close(); }
});

// spec §4.6：wipeSecrets 在 sync.disconnect() 之后、resetLocalData() 之前被 await；失败则整个重置失败，不报告成功。
test("local reset awaits proxy secret wiping after disconnect and fails as a whole when it fails", async () => {
  const database = seeded(":memory:");
  const events: string[] = [];
  let failWipe = true;
  const admin = new DataAdminService({
    database, deviceId: () => "device-a",
    beforeWipe: () => { events.push("beforeWipe"); },
    wipeSecrets: async () => {
      events.push("wipe:start");
      await new Promise<void>(resolve => setImmediate(resolve));
      events.push(`wipe:end:rows=${database.archives.list().length}`);
      if (failWipe) throw new Error("proxy_wipe_failed");
    },
    sync: { disconnect: async () => { events.push("disconnect"); return status(); }, status: () => status() }
  });
  try {
    await assert.rejects(admin.resetLocal(), /proxy_wipe_failed/);
    assert.deepEqual(events, ["disconnect", "wipe:start", "wipe:end:rows=2"], "先断开 Drive，再等密码清理；清理失败不得继续清库");
    assert.equal(database.archives.list().length, 2, "密码没清掉就不得报告重置成功");
    assert.equal(admin.isResetting, false);
    events.length = 0;
    failWipe = false;
    await admin.resetLocal();
    assert.deepEqual(events, ["disconnect", "wipe:start", "wipe:end:rows=2", "beforeWipe"]);
    assert.equal(database.archives.list().length, 0);
  } finally { database.close(); }
});

test("local reset removes proxy-secret.bin through the awaited wipe hook", async () => {
  const directory = mkdtempSync(join(tmpdir(), "polyask-reset-proxy-secret-"));
  const path = join(directory, "proxy-secret.bin");
  const secrets = new SecretFileStore(path, {
    backend: () => "gnome_libsecret", available: async () => true,
    encrypt: async value => Buffer.from(value, "utf8"), decrypt: async value => value.toString("utf8")
  });
  const database = seeded(":memory:");
  try {
    assert.equal(await secrets.write('{"version":1}'), "saved");
    assert.equal(existsSync(path), true);
    const admin = new DataAdminService({ database, deviceId: () => "device-a", wipeSecrets: () => secrets.clear(),
      sync: { disconnect: async () => status(), status: () => status() } });
    await admin.resetLocal();
    assert.equal(existsSync(path), false, "重置后 proxy-secret.bin 必须不存在");
  } finally { database.close(); rmSync(directory, { recursive: true, force: true }); }
});
