import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import test from "node:test";
import { readSource } from "./fixtures";
import { DesktopDatabase } from "../src/main/database";
import { SyncEngine, type SyncDrive } from "../src/main/sync-engine";
import { SyncRepository } from "../src/main/sync-repository";
import type { DriveFile } from "../src/main/drive-client";
import { folderMembershipId } from "../src/shared/task-folder";

const folder = { schema: 3 as const, id: "folder-a", name: "Review", createdAt: 100, updatedAt: 200, deviceId: "device-a" };
const target = { kind: "archive" as const, id: "archive-a" };
const membership = { schema: 3 as const, id: folderMembershipId(target, folder.id), folderId: folder.id, targetKind: target.kind, targetId: target.id, createdAt: 100, updatedAt: 200, deviceId: "device-a" };
const envelope = (body: any = folder, kind = "folder", schema = "3") => ({
  file: { id: `${kind}-${body.id}`, appProperties: { app: "polyask", kind, schema, id: createHash("sha256").update(body.id).digest("hex") } } as DriveFile, body
});
function setup(entries: ReturnType<typeof envelope>[] = []) {
  const database = DesktopDatabase.open(":memory:");
  database.meta.put("deviceId", "local");
  const repository = new SyncRepository(database);
  repository.saveConfig({ connected: true });
  const uploads: Array<{ file: DriveFile; body: unknown }> = [];
  let scans = 0;
  const drive: SyncDrive = {
    getStartToken: async () => "start", listFiles: async () => { scans++; return entries.map((x) => x.file); },
    listChanges: async () => ({ changes: [], newStartPageToken: "next" }),
    download: async (id) => entries.find((x) => x.file.id === id)?.body,
    upsert: async (id, name, appProperties, body) => { const file = { id: id ?? `upload-${uploads.length}`, name, appProperties }; uploads.push({ file, body }); return file; },
    clearAll: async () => undefined
  };
  const engine = new SyncEngine({ repository, drive, now: () => 1000, auth: {
    configured: () => true, securePersistence: () => true, connect: async () => {}, disconnect: async () => {}
  } });
  return { database, repository, drive, engine, uploads, scans: () => scans };
}

test("schema 3 uploads round-trip without title metadata and coexist with frozen schema 1/2", async () => {
  const source = setup();
  try {
    source.database.folders.put(folder);
    source.database.folders.putMembership(membership);
    assert.equal((await source.engine.syncNow()).state, "idle");
    assert.equal(source.uploads.length, 2);
    for (const item of source.uploads) { assert.equal(item.file.appProperties?.schema, "3"); assert.equal(item.file.appProperties?.preview, undefined); assert.ok(!item.file.name?.includes(folder.name)); }
    const receiver = setup([...source.uploads, JSON.parse(readSource("test/fixtures/schema1-archive-mixed.json")), JSON.parse(readSource("test/fixtures/schema2-decision.json"))]);
    try {
      assert.equal((await receiver.engine.syncNow()).state, "idle");
      assert.deepEqual(receiver.repository.folder(folder.id), folder);
      assert.deepEqual(receiver.repository.folderMembership(membership.id), membership);
      assert.equal(receiver.database.archives.list().length, 1);
      assert.equal(receiver.database.decisions.list().length, 1);
      assert.equal(receiver.repository.pending(), 0);
    } finally { receiver.database.close(); }
  } finally { source.database.close(); }
});

test("folder deletion is terminal regardless of later rename, replay or arrival order", () => {
  const tombstone = { id: folder.id, schema: 3, createdAt: 100, updatedAt: 150, deletedAt: 150, deviceId: "device-a" };
  for (const records of [[folder, tombstone], [tombstone, folder]]) {
    const s = setup();
    try { for (const record of records) assert.equal(s.repository.importFolder(record), true); assert.deepEqual(s.repository.folder(folder.id), tombstone); }
    finally { s.database.close(); }
  }
});

test("memberships arrive before targets and folders, merge independently, and can be explicitly rejoined", () => {
  const s = setup();
  try {
    const second = { ...membership, folderId: "folder-b", id: folderMembershipId(target, "folder-b") };
    s.repository.importFolderMembership(membership); s.repository.importFolderMembership(second);
    assert.equal(s.database.folders.listMemberships().length, 2);
    const removed = { ...membership, deletedAt: 200 };
    s.repository.importFolderMembership(removed); s.repository.importFolderMembership(membership);
    assert.deepEqual(s.repository.folderMembership(membership.id), removed);
    assert.deepEqual(s.repository.folderMembership(second.id), second);
    const joined = { ...membership, updatedAt: 201 };
    s.repository.importFolderMembership(joined);
    assert.deepEqual(s.repository.folderMembership(membership.id), joined);
    s.repository.importFolder({ id: folder.id, schema: 3, createdAt: 100, updatedAt: 300, deletedAt: 300, deviceId: "device-a" });
    s.repository.importFolderMembership({ ...joined, updatedAt: 400 });
    assert.equal(s.database.folders.list().length, 0);
    assert.equal(s.database.folders.listMemberships().length, 2);
  } finally { s.database.close(); }
});

for (const corrupt of [false, true]) test(`upgrade replays skipped schema 3 and corrupt replay retains write lock: ${corrupt}`, async () => {
  const entry = envelope(corrupt ? { ...folder, name: null } : folder);
  const s = setup([entry]);
  s.repository.saveConfig({ pageToken: "old-cursor", readOnly: true, futureFiles: { [entry.file.id]: 3 } });
  s.repository.enqueue({ key: "state", kind: "state", nextAt: 0, attempt: 0 });
  try {
    const status = await s.engine.syncNow();
    assert.equal(s.scans(), 1); assert.equal(status.readOnly, corrupt);
    assert.equal(s.uploads.length, corrupt ? 0 : 1); assert.equal(s.repository.pending(), corrupt ? 1 : 0);
    assert.deepEqual(s.repository.folder(folder.id), corrupt ? null : folder);
  } finally { s.database.close(); }
});

for (const entry of [envelope({ ...folder, schema: 4 }), envelope(folder, "folder", "4")]) test("unknown schema 4 blocks writes", async () => {
  const s = setup([entry]); s.database.folders.put(folder);
  try { assert.equal((await s.engine.syncNow()).state, "schema"); assert.equal(s.uploads.length, 0); assert.equal(s.repository.pending(), 1); }
  finally { s.database.close(); }
});

test("malformed membership identity and mismatched metadata are rejected", async () => {
  const s = setup([envelope({ ...membership, id: "forged" }, "folderMembership"), { ...envelope(), body: { ...folder, id: "other" } }]);
  try { assert.equal((await s.engine.syncNow()).errorCount, 2); assert.equal(s.database.folders.listMemberships().length, 0); assert.equal(s.database.folders.list().length, 0); }
  finally { s.database.close(); }
});

test("incremental folder tombstones and membership removal propagate without deleting content", async () => {
  const removedFolder = { id: folder.id, schema: 3 as const, createdAt: 100, updatedAt: 300, deletedAt: 300, deviceId: "device-a" };
  const removedMembership = { ...membership, updatedAt: 300, deletedAt: 300 };
  const entries = [envelope(), envelope(membership, "folderMembership")];
  const s = setup(entries);
  try {
    await s.engine.syncNow();
    entries[0].body = removedFolder; entries[1].body = removedMembership;
    s.drive.listChanges = async () => ({ changes: entries.map((x) => ({ file: x.file })), newStartPageToken: "new" });
    assert.equal((await s.engine.syncNow()).state, "idle");
    assert.deepEqual(s.repository.folder(folder.id), removedFolder);
    assert.deepEqual(s.repository.folderMembership(membership.id), removedMembership);
    assert.equal(s.scans(), 1);
  } finally { s.database.close(); }
});

test("membership concurrent versions converge by device id and exact-tie deletion", () => {
  const winner = { ...membership, deviceId: "device-z" };
  for (const records of [[membership, winner], [winner, membership]]) {
    const s = setup();
    try {
      for (const record of records) s.repository.importFolderMembership(record);
      assert.deepEqual(s.repository.folderMembership(membership.id), winner);
      const removed = { ...winner, deletedAt: winner.updatedAt };
      s.repository.importFolderMembership(removed); s.repository.importFolderMembership(winner);
      assert.deepEqual(s.repository.folderMembership(membership.id), removed);
    } finally { s.database.close(); }
  }
});

for (const code of ["invalid_response", "not_found", "offline"]) test(`failed upgrade download keeps lock and outbox: ${code}`, async () => {
  const entry = envelope(); const s = setup([entry]);
  s.repository.saveConfig({ pageToken: "cursor", readOnly: true, futureFiles: { [entry.file.id]: 3 } });
  s.repository.enqueue({ key: "state", kind: "state", nextAt: 0, attempt: 0 });
  s.drive.download = async () => { throw Object.assign(new Error(code), { code }); };
  try {
    assert.equal((await s.engine.syncNow()).readOnly, true);
    assert.equal(s.uploads.length, 0); assert.equal(s.repository.pending(), 1);
    assert.deepEqual(s.repository.config().futureFiles, { [entry.file.id]: 3 });
  } finally { s.database.close(); }
});

test("deleted future file unlocks after full listing and changes confirm absence", async () => {
  const s = setup(); s.repository.saveConfig({ pageToken: "cursor", readOnly: true, futureFiles: { missing: 3 } });
  s.repository.enqueue({ key: "state", kind: "state", nextAt: 0, attempt: 0 });
  try { assert.equal((await s.engine.syncNow()).readOnly, false); assert.equal(s.uploads.length, 1); }
  finally { s.database.close(); }
});

test("frozen schema 3 fixtures import both live and tombstone folder entities", async () => {
  for (const suffix of ["", "-tombstone"]) {
    const folderFixture = JSON.parse(readSource(`test/fixtures/schema3-folder${suffix}.json`));
    const membershipFixture = JSON.parse(readSource(`test/fixtures/schema3-folder-membership${suffix}.json`));
    const s = setup([folderFixture, membershipFixture]);
    try {
      assert.equal((await s.engine.syncNow()).state, "idle");
      assert.deepEqual(s.repository.folder(folderFixture.body.id), folderFixture.body);
      assert.deepEqual(s.repository.folderMembership(membershipFixture.body.id), membershipFixture.body);
    } finally { s.database.close(); }
  }
});

test("long Unicode schema 3 identities use bounded opaque Drive metadata and reuse pulled files", async () => {
  const longFolder = { ...folder, id: "夹".repeat(128) };
  const longTarget = { kind: "archive" as const, id: "果".repeat(128) };
  const longMembership = { ...membership, folderId: longFolder.id, targetId: longTarget.id, id: folderMembershipId(longTarget, longFolder.id) };
  const source = setup();
  try {
    source.database.folders.put(longFolder); source.database.folders.putMembership(longMembership);
    await source.engine.syncNow();
    for (const item of source.uploads) {
      for (const [key, value] of Object.entries(item.file.appProperties!)) assert.ok(Buffer.byteLength(key + value) <= 124);
      assert.match(item.file.appProperties!.id, /^[a-f0-9]{64}$/);
      assert.ok(!item.file.name!.includes("夹"));
    }
    const receiver = setup(source.uploads);
    try {
      await receiver.engine.syncNow();
      assert.deepEqual(receiver.repository.folder(longFolder.id), longFolder);
      assert.deepEqual(receiver.repository.folderMembership(longMembership.id), longMembership);
      receiver.database.folders.put({ ...longFolder, name: "Renamed", updatedAt: 300 });
      receiver.database.folders.putMembership({ ...longMembership, updatedAt: 300, deletedAt: 300 });
      await receiver.engine.syncNow();
      assert.deepEqual(receiver.uploads.map((x) => x.file.id), source.uploads.map((x) => x.file.id));
    } finally { receiver.database.close(); }
  } finally { source.database.close(); }
});

test("a drained local deletion repairs a later cloud rename so a fresh device cannot revive the folder", async () => {
  const deleted = { id: folder.id, schema: 3 as const, createdAt: 100, updatedAt: 300, deletedAt: 300, deviceId: "local" };
  const stale = envelope({ ...folder, updatedAt: 400, name: "Offline rename" });
  const s = setup([stale]);
  s.database.folders.put(deleted, false);
  try {
    assert.equal(s.repository.pending(), 0);
    assert.equal((await s.engine.syncNow()).state, "idle");
    assert.equal(s.uploads.length, 1);
    assert.equal(s.uploads[0].file.id, stale.file.id);
    assert.deepEqual(s.uploads[0].body, deleted);
    assert.equal(s.repository.pending(), 0);
    const fresh = setup(s.uploads);
    try { await fresh.engine.syncNow(); assert.deepEqual(fresh.repository.folder(folder.id), deleted); }
    finally { fresh.database.close(); }
    s.drive.listChanges = async () => ({ changes: [{ file: s.uploads[0].file }], newStartPageToken: "repaired" });
    s.drive.download = async () => deleted;
    await s.engine.syncNow();
    assert.equal(s.uploads.length, 1, "observing repaired deletion must not enqueue another repair");
  } finally { s.database.close(); }
});

test("a newer local tombstone repairs an older remote tombstone only once", async () => {
  const older = { id: folder.id, schema: 3 as const, createdAt: 100, updatedAt: 300, deletedAt: 300, deviceId: "local" };
  const newer = { ...older, updatedAt: 400, deletedAt: 400 };
  const s = setup([envelope(older)]); s.database.folders.put(newer, false);
  try {
    await s.engine.syncNow(); assert.equal(s.uploads.length, 1); assert.deepEqual(s.uploads[0].body, newer);
    assert.equal(s.repository.pending(), 0);
    s.repository.importFolder(newer); assert.equal(s.repository.pending(), 0);
  } finally { s.database.close(); }
});

test("newer local folder name repairs an older shared cloud body without repeated uploads", async () => {
  const newer = { ...folder, name: "New name", updatedAt: 300 };
  const entry = envelope(folder); const s = setup([entry]); s.database.folders.put(newer, false);
  try {
    await s.engine.syncNow(); assert.equal(s.uploads.length, 1);
    assert.equal(s.uploads[0].file.id, entry.file.id); assert.deepEqual(s.uploads[0].body, newer);
    s.drive.listChanges = async () => ({ changes: [{ file: entry.file }], newStartPageToken: "repaired" });
    s.drive.download = async () => newer;
    await s.engine.syncNow(); assert.equal(s.uploads.length, 1);
  } finally { s.database.close(); }
});

for (const remove of [true, false]) test(`membership winner repairs shared cloud loser and converges: remove=${remove}`, async () => {
  const loser = remove ? membership : { ...membership, deletedAt: 200 };
  // Removal wins even an exact-version tie; a later explicit rejoin wins by time.
  const winner = remove ? { ...membership, deletedAt: 200 } : { ...membership, updatedAt: 300 };
  const entry = envelope(loser, "folderMembership"); const s = setup([entry]);
  s.database.folders.putMembership(winner, false);
  try {
    await s.engine.syncNow(); assert.equal(s.uploads.length, 1);
    assert.equal(s.uploads[0].file.id, entry.file.id); assert.deepEqual(s.uploads[0].body, winner);
    const fresh = setup(s.uploads);
    try { await fresh.engine.syncNow(); assert.deepEqual(fresh.repository.folderMembership(membership.id), winner); }
    finally { fresh.database.close(); }
    s.drive.listChanges = async () => ({ changes: [{ file: entry.file }], newStartPageToken: "repaired" });
    s.drive.download = async () => winner;
    await s.engine.syncNow(); assert.equal(s.uploads.length, 1);
  } finally { s.database.close(); }
});
