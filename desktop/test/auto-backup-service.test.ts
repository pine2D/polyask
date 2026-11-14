import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  AutoBackupService,
  CURRENT_PROTECTED_SYNC_SCHEMA,
  MAX_AUTO_BACKUPS,
  captureStartupUpgradeSnapshot,
  compareSemver
} from "../src/main/auto-backup-service";
import { BackupService } from "../src/main/backup-service";
import { DataAdminService } from "../src/main/data-admin-service";
import { DesktopDatabase, LOCAL_DB_SCHEMA_VERSION, peekSqliteUserVersion } from "../src/main/database";
import type { SyncStatus } from "../src/shared/sync";
import { question } from "./lib/question-attachment-fixtures";

const IDLE_SYNC: SyncStatus = {
  state: "idle",
  connected: false,
  pending: 0,
  errorCount: 0,
  readOnly: false,
  oauthConfigured: false,
  secureTokenStorage: true
};

function seedTemplate(db: DesktopDatabase, id = "tpl-1", text = "Saved prompt template"): void {
  db.state.put(`template:${id}`, { id, name: "Daily", text, updatedAt: 100, deviceId: "dev-1" }, 100, false);
}

test("compareSemver orders stable and prerelease versions deterministically", () => {
  assert.equal(compareSemver("1.35.0", "1.34.0"), 1);
  assert.equal(compareSemver("1.34.0", "1.34.0"), 0);
  assert.equal(compareSemver("1.34.0", "1.35.0"), -1);
  assert.equal(compareSemver("1.35.0", "1.35.0-beta.1"), 1);
  assert.equal(compareSemver("1.35.0-beta.1", "1.35.0"), -1);
});

test("fresh empty database records protected runtime without writing snapshot files", async () => {
  const dir = await mkdtemp(join(tmpdir(), "polyask-auto-backup-empty-"));
  const dbPath = join(dir, "polyask.sqlite");
  assert.equal(peekSqliteUserVersion(dbPath), null);
  const db = DesktopDatabase.open(dbPath);
  try {
    assert.equal(peekSqliteUserVersion(dbPath), LOCAL_DB_SCHEMA_VERSION);
    const created = await captureStartupUpgradeSnapshot(db, {
      userDataPath: dir,
      currentVersion: "1.34.0",
      preOpenDbSchema: null
    });
    assert.equal(created, null);
    const saved = db.meta.get<{ version: string; dbSchema: number; syncSchema: number }>("lastProtectedRuntime");
    assert.equal(saved?.version, "1.34.0");
    assert.equal(saved?.dbSchema, LOCAL_DB_SCHEMA_VERSION);
    assert.equal(saved?.syncSchema, CURRENT_PROTECTED_SYNC_SCHEMA);
    await assert.rejects(stat(join(dir, "auto-backups")), /ENOENT/);
  } finally {
    db.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("existing database captures pre-upgrade snapshots on first tracking, version bump, and schema bump", async () => {
  const dir = await mkdtemp(join(tmpdir(), "polyask-auto-backup-upgrade-"));
  const db = DesktopDatabase.open(":memory:");
  const backup = new BackupService(db, { deviceId: () => "dev-1" });
  let clock = 1_790_000_000_000;
  let seq = 0;
  const service = new AutoBackupService(db, backup, {
    userDataPath: dir,
    now: () => (clock += 1_000),
    createId: () => `0000000${++seq}-0000-4000-8000-000000000000`
  });
  try {
    seedTemplate(db, "tpl-1", "Original v1.34 prompt");
    const first = await service.captureIfUpgrading({
      currentVersion: "1.35.0",
      preOpenDbSchema: LOCAL_DB_SCHEMA_VERSION
    });
    assert.equal(first !== null, true);
    assert.equal(first?.fromVersion, null);
    assert.equal(first?.toVersion, "1.35.0");
    assert.equal(first?.textOnly, false);

    const repeat = await service.captureIfUpgrading({
      currentVersion: "1.35.0",
      preOpenDbSchema: LOCAL_DB_SCHEMA_VERSION
    });
    assert.equal(repeat, null);

    const dbBump = await service.captureIfUpgrading({
      currentVersion: "1.35.0",
      currentDbSchema: LOCAL_DB_SCHEMA_VERSION + 1,
      preOpenDbSchema: LOCAL_DB_SCHEMA_VERSION
    });
    assert.equal(dbBump?.fromVersion, "1.35.0");
    assert.equal(dbBump?.fromDbSchema, LOCAL_DB_SCHEMA_VERSION);
    assert.equal(dbBump?.toDbSchema, LOCAL_DB_SCHEMA_VERSION + 1);

    const syncBump = await service.captureIfUpgrading({
      currentVersion: "1.35.0",
      currentDbSchema: LOCAL_DB_SCHEMA_VERSION + 1,
      currentSyncSchema: CURRENT_PROTECTED_SYNC_SCHEMA + 1
    });
    assert.equal(syncBump?.toSyncSchema, CURRENT_PROTECTED_SYNC_SCHEMA + 1);

    const listed = await service.list();
    assert.equal(listed.length, 3);
    assert.equal(listed[0].id, syncBump?.id);
  } finally {
    backup.dispose();
    db.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("missing cloud-only attachment blobs fall back to text-only snapshot and rolling cap keeps newest 5", async () => {
  const dir = await mkdtemp(join(tmpdir(), "polyask-auto-backup-cap-"));
  const db = DesktopDatabase.open(":memory:");
  const backup = new BackupService(db, { deviceId: () => "dev-1" });
  let clock = 1_790_100_000_000;
  let seq = 0;
  const service = new AutoBackupService(db, backup, {
    userDataPath: dir,
    now: () => (clock += 5_000),
    createId: () => `abcdef0${++seq}-0000-4000-8000-000000000000`
  });
  try {
    db.questions.put(question("q-cloud-img", 2));

    for (let minor = 1; minor <= 7; minor++) {
      const snap = await service.captureIfUpgrading({ currentVersion: `1.${40 + minor}.0` });
      assert.equal(snap?.textOnly, true);
    }

    const listed = await service.list();
    assert.equal(listed.length, MAX_AUTO_BACKUPS);
    assert.equal(listed[0].toVersion, "1.47.0");
    assert.equal(listed[MAX_AUTO_BACKUPS - 1].toVersion, "1.43.0");
    const files = await readdir(join(dir, "auto-backups"));
    assert.equal(files.length, MAX_AUTO_BACKUPS * 2);
  } finally {
    backup.dispose();
    db.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("capture fails open on disk write error without advancing lastProtectedRuntime, then restores cleanly", async () => {
  const dir = await mkdtemp(join(tmpdir(), "polyask-auto-backup-restore-"));
  const db = DesktopDatabase.open(":memory:");
  const backup = new BackupService(db, { deviceId: () => "dev-1" });
  const service = new AutoBackupService(db, backup, { userDataPath: dir, now: () => 1_790_200_000_000 });
  try {
    seedTemplate(db, "tpl-restore", "Before upgrade content");
    await writeFile(join(dir, "auto-backups"), "blocking-file", "utf8");

    const failed = await service.captureIfUpgrading({ currentVersion: "1.35.0" });
    assert.equal(failed, null);
    assert.equal(db.meta.get("lastProtectedRuntime"), null);

    await rm(join(dir, "auto-backups"), { force: true });
    const captured = await service.captureIfUpgrading({ currentVersion: "1.35.0" });
    assert.equal(captured !== null, true);

    seedTemplate(db, "tpl-restore", "Accidental post-upgrade overwrite");
    const preview = await service.preview(captured!.id);
    assert.equal(preview.filename, captured!.filename);
    const conflict = preview.items.find((item) => item.key === "template:tpl-restore");
    assert.equal(conflict?.status, "conflict");
    const applied = backup.apply(preview.token, ["template:tpl-restore"]);
    assert.equal(applied.imported, 1);
    assert.equal(db.state.get<{ text: string }>("template:tpl-restore")?.text, "Before upgrade content");

    const copyDest = join(dir, "exported-copy.polyask");
    await service.exportCopy(captured!.id, copyDest);
    assert.equal((await readFile(copyDest)).byteLength, captured!.sizeBytes);

    const admin = new DataAdminService({
      database: db,
      deviceId: () => "dev-1",
      sync: { disconnect: async () => IDLE_SYNC, status: () => IDLE_SYNC },
      wipeAutoBackups: () => service.clearAll()
    });
    await admin.resetLocal();
    assert.deepEqual(await service.list(), []);
    await assert.rejects(stat(join(dir, "auto-backups")), /ENOENT/);
  } finally {
    backup.dispose();
    db.close();
    await rm(dir, { recursive: true, force: true });
  }
});
