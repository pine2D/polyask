import assert from "node:assert/strict";
import test from "node:test";

import { DesktopDatabase } from "../src/main/database";
import type { DriveFile } from "../src/main/drive-client";
import { SyncEngine, type SyncAuth, type SyncDrive } from "../src/main/sync-engine";
import { SyncRepository } from "../src/main/sync-repository";
import { createArchiveRecord, updateArchiveRecord } from "../src/shared/archive";

const auth = (): SyncAuth => ({ configured: () => true, securePersistence: () => true, connect: async () => undefined, disconnect: async () => undefined });

function connected() {
  const database = DesktopDatabase.open(":memory:");
  database.meta.put("deviceId", "desktop-device");
  const repository = new SyncRepository(database);
  repository.saveConfig({ connected: true });
  return { database, repository };
}

const archiveProps = (id: string) => ({ app: "polyask", schema: "1", kind: "archive", id, deleted: "0", preview: "" });

test("a full scan converges same-key duplicates onto one deterministic file and rewrites it with the merged winner", async () => {
  const { database, repository } = connected();
  const older = createArchiveRecord({ text: "q", task: "q", results: [] }, { id: "arc-1", now: 10, deviceId: "other" });
  const newer = updateArchiveRecord(older, { note: "edited" }, { now: 20, deviceId: "other" });
  const bodies: Record<string, unknown> = { "file-b": newer, "file-a": older };
  const files: DriveFile[] = [{ id: "file-b", appProperties: archiveProps("arc-1") }, { id: "file-a", appProperties: archiveProps("arc-1") }];
  const removed: string[] = [];
  const upserts: (string | null)[] = [];
  const drive: SyncDrive = {
    getStartToken: async () => "start",
    listFiles: async () => files,
    listChanges: async () => ({ changes: [], newStartPageToken: "next" }),
    download: async (id) => bodies[id],
    upsert: async (id, _name, _props, body) => { upserts.push(id); bodies[id ?? "created"] = body; return { id: id ?? "created" }; },
    remove: async (id) => { removed.push(id); },
    clearAll: async () => undefined
  };
  try {
    const status = await new SyncEngine({ repository, drive, auth: auth(), now: () => 50_000 }).syncNow();
    assert.equal(status.state, "idle");
    assert.deepEqual(removed, ["file-b"], "every device must pick the same keeper: the smallest file id");
    assert.deepEqual(repository.driveFiles().map((file) => file.id), ["file-a"]);
    assert.deepEqual(upserts, ["file-a"], "the keeper is rewritten with the merged winner, never re-created");
    assert.equal((bodies["file-a"] as { note?: string }).note, "edited");
  } finally { database.close(); }
});

test("duplicates of another device's own files are left for that device to converge", async () => {
  const { database, repository } = connected();
  const fragment = { schema: 1, deviceId: "other", settings: {}, templates: {}, groups: {} };
  const props = { app: "polyask", schema: "1", kind: "state", id: "other" };
  const removed: string[] = [];
  const drive: SyncDrive = {
    getStartToken: async () => "start",
    listFiles: async () => [{ id: "state-b", appProperties: props }, { id: "state-a", appProperties: props }],
    listChanges: async () => ({ changes: [], newStartPageToken: "next" }),
    download: async () => fragment,
    upsert: async () => ({ id: "unused" }),
    remove: async (id) => { removed.push(id); },
    clearAll: async () => undefined
  };
  try {
    await new SyncEngine({ repository, drive, auth: auth(), now: () => 50_000 }).syncNow();
    assert.deepEqual(removed, []);
  } finally { database.close(); }
});

test("updating a file another device already removed falls back to the surviving copy instead of failing", async () => {
  const { database, repository } = connected();
  const record = createArchiveRecord({ text: "q", task: "q", results: [] }, { id: "arc-2", now: 10, deviceId: "desktop-device" });
  repository.putDriveFile({ id: "gone", appProperties: archiveProps("arc-2") }, "archive:arc-2", 1);
  database.archives.put(record);
  const upserts: (string | null)[] = [];
  const drive: SyncDrive = {
    getStartToken: async () => "start",
    listFiles: async () => [],
    listChanges: async () => ({ changes: [], newStartPageToken: "next" }),
    download: async () => null,
    upsert: async (id) => {
      upserts.push(id);
      if (id === "gone") throw Object.assign(new Error("not_found"), { code: "not_found", status: 404 });
      return { id: "fresh" };
    },
    clearAll: async () => undefined
  };
  try {
    const engine = new SyncEngine({ repository, drive, auth: auth(), now: () => 50_000 });
    // Incremental pulls keep the stale index entry; only the upload discovers that it is gone.
    repository.saveConfig({ pageToken: "token" });
    const status = await engine.syncNow();
    assert.equal(status.state, "idle");
    assert.deepEqual(upserts, ["gone", null]);
    assert.equal(repository.findDriveFile("archive:arc-2")?.id, "fresh");
    assert.equal(repository.pending(), 0);
  } finally { database.close(); }
});
