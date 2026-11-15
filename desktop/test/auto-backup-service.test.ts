import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import {
  AutoBackupService,
  CURRENT_PROTECTED_SYNC_SCHEMA,
  MAX_AUTO_BACKUPS,
  captureStartupUpgradeSnapshot,
  commitPreUpgradeSnapshotState,
  compareSemver,
  preparePreUpgradeSnapshot
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

test("preparePreUpgradeSnapshot captures WAL-consistent data before open/migration and leaves no temp files", async () => {
  const dir = await mkdtemp(join(tmpdir(), "polyask-pre-migration-snap-"));
  const dbPath = join(dir, "polyask.sqlite");
  try {
    // 1. Fresh non-existent DB: creates no auto-backups dir, commits runtime state after open
    const freshReceipt = await preparePreUpgradeSnapshot(dbPath, {
      userDataPath: dir,
      currentVersion: "1.34.0"
    });
    assert.equal(freshReceipt.summary, null);
    assert.equal(freshReceipt.shouldRecordRuntime, true);
    await assert.rejects(stat(join(dir, "auto-backups")), /ENOENT/);

    const initialDb = DesktopDatabase.open(dbPath);
    commitPreUpgradeSnapshotState(initialDb, freshReceipt, { currentVersion: "1.34.0" });
    assert.equal(initialDb.meta.get<{ version: string }>("lastProtectedRuntime")?.version, "1.34.0");
    seedTemplate(initialDb, "tpl-pre-migrate", "Safe pre-migration v1.34 text");
    initialDb.close();

    // Simulate older schema version in header before opening 1.35.0
    const rawPre = new DatabaseSync(dbPath);
    rawPre.exec(`PRAGMA user_version = ${LOCAL_DB_SCHEMA_VERSION - 1}`);
    rawPre.close();

    // 2. Pre-upgrade snapshot runs BEFORE DesktopDatabase.open(dbPath)
    const upgradeReceipt = await preparePreUpgradeSnapshot(dbPath, {
      userDataPath: dir,
      currentVersion: "1.35.0"
    });
    assert.equal(upgradeReceipt.summary !== null, true);
    assert.equal(upgradeReceipt.summary?.fromVersion, "1.34.0");
    assert.equal(upgradeReceipt.summary?.toVersion, "1.35.0");
    assert.equal(upgradeReceipt.summary?.fromDbSchema, LOCAL_DB_SCHEMA_VERSION - 1);
    assert.equal(upgradeReceipt.summary?.toDbSchema, LOCAL_DB_SCHEMA_VERSION);

    const dirEntries = await readdir(dir);
    assert.equal(dirEntries.some((entry) => entry.includes(".sqlite.tmp")), false);

    // Simulate a faulty migration mutating rows before user notices
    const mutatedDb = DesktopDatabase.open(dbPath);
    try {
      commitPreUpgradeSnapshotState(mutatedDb, upgradeReceipt, { currentVersion: "1.35.0" });
      assert.equal(mutatedDb.meta.get<{ version: string }>("lastProtectedRuntime")?.version, "1.35.0");
      seedTemplate(mutatedDb, "tpl-pre-migrate", "Corrupted by post-snapshot migration");

      const backup = new BackupService(mutatedDb, { deviceId: () => "dev-1" });
      const service = new AutoBackupService(mutatedDb, backup, { userDataPath: dir });
      try {
        const preview = await service.preview(upgradeReceipt.summary!.id);
        backup.apply(preview.token, ["template:tpl-pre-migrate"]);
        assert.equal(
          mutatedDb.state.get<{ text: string }>("template:tpl-pre-migrate")?.text,
          "Safe pre-migration v1.34 text"
        );
      } finally {
        backup.dispose();
      }
    } finally {
      mutatedDb.close();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("malformed tombstone JSON never crashes startup on upgrade or same-version restart", async () => {
  const dir = await mkdtemp(join(tmpdir(), "polyask-auto-backup-corrupt-tombstone-"));
  const dbPath = join(dir, "polyask.sqlite");
  try {
    const setupDb = DesktopDatabase.open(dbPath);
    setupDb.close();

    const raw = new DatabaseSync(dbPath);
    raw.prepare("INSERT INTO archives (id, body, sort_time, deleted_at) VALUES (?, ?, ?, ?)").run(
      "arch-corrupt-tombstone",
      "{not-valid-json",
      100,
      200
    );
    raw.close();

    // Upgrade path with corrupt tombstone: fails open (returns null, does not throw)
    const upgradeReceipt = await preparePreUpgradeSnapshot(dbPath, {
      userDataPath: dir,
      currentVersion: "1.35.0"
    });
    assert.equal(upgradeReceipt.summary, null);
    assert.equal(upgradeReceipt.shouldRecordRuntime, false);

    const db = DesktopDatabase.open(dbPath);
    try {
      const captured = await captureStartupUpgradeSnapshot(db, {
        userDataPath: dir,
        currentVersion: "1.35.0"
      });
      assert.equal(captured, null);
      assert.equal(db.meta.get("lastProtectedRuntime"), null);

      // Same-version restart path with corrupt tombstone: skips table scan cleanly
      db.meta.put("lastProtectedRuntime", {
        version: "1.35.0",
        dbSchema: LOCAL_DB_SCHEMA_VERSION,
        syncSchema: CURRENT_PROTECTED_SYNC_SCHEMA,
        updatedAt: 1_790_300_000_000
      });
    } finally {
      db.close();
    }

    const restartReceipt = await preparePreUpgradeSnapshot(dbPath, {
      userDataPath: dir,
      currentVersion: "1.35.0"
    });
    assert.deepEqual(restartReceipt, { summary: null, shouldRecordRuntime: false });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
