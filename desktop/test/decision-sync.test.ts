import assert from "node:assert/strict";
import test from "node:test";
import { readSource } from "./fixtures";
import { DesktopDatabase } from "../src/main/database";
import { SyncEngine, type SyncDrive } from "../src/main/sync-engine";
import { SyncRepository } from "../src/main/sync-repository";
import type { DriveFile } from "../src/main/drive-client";
import type { DecisionRecord } from "../src/shared/decision";

const decision: DecisionRecord = JSON.parse(readSource("test/fixtures/schema2-decision.json")).body;
const envelope = (body: unknown = decision, schema = "2", kind = "decision", id = decision.id) => ({
  file: { id: `${kind}-${id}`, appProperties: { app: "polyask", kind, schema, id } } as DriveFile, body
});
function setup(entries = [envelope()]) {
  const database = DesktopDatabase.open(":memory:");
  database.meta.put("deviceId", "local");
  const repository = new SyncRepository(database);
  repository.saveConfig({ connected: true });
  const uploads: Array<{ file: DriveFile; body: unknown }> = [];
  let scans = 0;
  const drive: SyncDrive = {
    getStartToken: async () => "start",
    listFiles: async () => { scans++; return entries.map((entry) => entry.file); },
    listChanges: async () => ({ changes: [], newStartPageToken: "next" }),
    download: async (id) => entries.find((entry) => entry.file.id === id)?.body,
    upsert: async (id, name, appProperties, body) => {
      const file = { id: id ?? "uploaded", name, appProperties };
      uploads.push({ file, body }); return file;
    },
    clearAll: async () => undefined
  };
  const engine = new SyncEngine({ repository, drive, now: () => 1000, auth: {
    configured: () => true, securePersistence: () => true, connect: async () => {}, disconnect: async () => {}
  } });
  return { database, repository, engine, uploads, drive, scans: () => scans };
}

test("decision schema 2 is downloaded alongside unchanged schema 1 data", async () => {
  const legacy = JSON.parse(readSource("test/fixtures/schema1-archive-mixed.json"));
  const { database, repository, engine } = setup([envelope(), legacy]);
  try {
    assert.equal((await engine.syncNow()).state, "idle");
    assert.deepEqual(database.decisions.get(decision.id), decision);
    assert.deepEqual(repository.archive(legacy.body.id), legacy.body);
    assert.equal(repository.pending(), 0);
  } finally { database.close(); }
});

test("upgrade replays previously skipped decision files even with a current cursor", async () => {
  const { database, repository, engine, scans } = setup();
  repository.saveConfig({ pageToken: "old-cursor", readOnly: true, futureFiles: { "decision-decision-a": 2 } });
  try {
    assert.equal((await engine.syncNow()).state, "idle");
    assert.deepEqual(database.decisions.get(decision.id), decision);
    assert.equal(scans(), 1);
    assert.deepEqual(repository.config().futureFiles, {});
  } finally { database.close(); }
});

test("decision upload and deletion retain schema 2 and do not resurrect stale cloud data", async () => {
  const { database, repository, engine, uploads } = setup([]);
  try {
    database.decisions.put(decision);
    assert.equal((await engine.syncNow()).state, "idle");
    assert.equal(uploads[0].file.appProperties?.schema, "2");
    assert.equal(uploads[0].file.appProperties?.kind, "decision");
    assert.deepEqual(uploads[0].body, decision);
    database.decisions.delete(decision.id, 300, "local");
    await engine.syncNow();
    const tombstone = database.decisions.get(decision.id)!;
    assert.ok("deletedAt" in tombstone);
    assert.deepEqual(uploads[1].body, tombstone);
    assert.equal(uploads[1].file.appProperties?.deleted, "1");
    assert.equal(repository.importDecision(decision), true);
    assert.deepEqual(database.decisions.get(decision.id), tombstone);
    assert.equal(repository.pending(), 0);
  } finally { database.close(); }
});

test("decision tombstones downloaded before stale duplicate files win independently of order", async () => {
  const tombstone = JSON.parse(readSource("test/fixtures/schema2-decision-tombstone.json")).body;
  const stale = { ...envelope(), file: { ...envelope().file, id: "stale" } };
  const { database, engine } = setup([envelope(tombstone), stale]);
  try {
    await engine.syncNow();
    assert.deepEqual(database.decisions.get(decision.id), tombstone);
    assert.deepEqual(database.decisions.list(), []);
  } finally { database.close(); }
});

for (const [name, entry] of [["wrong id", envelope({ ...decision, id: "wrong" })], ["wrong body schema", envelope({ ...decision, schema: 1 })], ["wrong metadata schema", envelope(decision, "1")]] as const) {
  test(`invalid decision envelope is rejected: ${name}`, async () => {
    const { database, repository, engine } = setup([entry]);
    try {
      const status = await engine.syncNow();
      assert.equal(status.errorCount, 1);
      assert.equal(database.decisions.get(decision.id), null);
      assert.equal(repository.driveFiles().length, 0);
    } finally { database.close(); }
  });
}

for (const entry of [envelope({ ...decision, schema: 3 }), envelope(decision, "3"), envelope({}, "2", "state")]) {
  test(`unsupported format blocks pending uploads: ${JSON.stringify(entry.file.appProperties)}`, async () => {
    const { database, repository, engine, uploads } = setup([entry]);
    repository.enqueue({ key: "state", kind: "state", nextAt: 0, attempt: 0 });
    try {
      assert.equal((await engine.syncNow()).state, "schema");
      assert.equal(uploads.length, 0);
      assert.equal(repository.pending(), 1);
    } finally { database.close(); }
  });
}

test("decision merge converges by version and device with deletion winning an exact tie", () => {
  const { database, repository } = setup([]);
  try {
    const higherDevice = { ...decision, deviceId: "device-z", conclusion: "Choose B" };
    for (const candidates of [[decision, higherDevice], [higherDevice, decision]]) {
      for (const candidate of candidates) assert.equal(repository.importDecision(candidate), true);
      assert.deepEqual(repository.decision(decision.id), higherDevice);
    }
    const deleted = { id: decision.id, schema: 2, createdAt: 100, updatedAt: 200, deletedAt: 200, deviceId: "device-z" };
    repository.importDecision(deleted);
    repository.importDecision(higherDevice);
    assert.deepEqual(repository.decision(decision.id), deleted);
  } finally { database.close(); }
});

test("legacy future-file lists also replay decision data on upgrade", async () => {
  const { database, repository, engine, scans } = setup();
  repository.saveConfig({ pageToken: "old-cursor", readOnly: true, futureFileIds: ["decision-decision-a"] });
  try {
    assert.equal((await engine.syncNow()).state, "idle");
    assert.deepEqual(database.decisions.get(decision.id), decision);
    await engine.syncNow();
    assert.equal(scans(), 1, "successful replay must resume incremental sync");
  } finally { database.close(); }
});

test("re-upgrade replays decisions skipped by an old binary despite a preserved capability marker", async () => {
  const { database, repository, engine } = setup();
  database.meta.put("syncConfig", { ...repository.config(), supportedSchema: 2, pageToken: "downgraded-cursor", readOnly: true, futureFiles: { "decision-decision-a": 2 } });
  try {
    assert.equal((await engine.syncNow()).state, "idle");
    assert.deepEqual(database.decisions.get(decision.id), decision);
    assert.deepEqual(repository.config().futureFiles, {});
  } finally { database.close(); }
});

for (const invalidDownload of [false, true]) {
  test(`corrupt replay retains the old schema lock and queued writes (download error: ${invalidDownload})`, async () => {
    const { database, repository, engine, uploads, drive } = setup([envelope({ ...decision, title: null })]);
    repository.saveConfig({ pageToken: "old-cursor", readOnly: true, futureFiles: { "decision-decision-a": 2 } });
    repository.enqueue({ key: "state", kind: "state", nextAt: 0, attempt: 0 });
    if (invalidDownload) drive.download = async () => { throw Object.assign(new Error("invalid_response"), { code: "invalid_response" }); };
    try {
      const status = await engine.syncNow();
      assert.equal(status.state, "schema");
      assert.equal(status.errorCount, 1);
      assert.deepEqual(repository.config().futureFiles, { "decision-decision-a": 2 });
      assert.equal(uploads.length, 0);
      assert.equal(repository.pending(), 1);
    } finally { database.close(); }
  });
}

test("upgrade replay unlocks writes after listing and changes confirm the future file was deleted", async () => {
  const { database, repository, engine, uploads } = setup([]);
  repository.saveConfig({ pageToken: "old-cursor", readOnly: true, futureFiles: { "decision-decision-a": 2 } });
  repository.enqueue({ key: "state", kind: "state", nextAt: 0, attempt: 0 });
  try {
    assert.equal((await engine.syncNow()).state, "idle");
    assert.deepEqual(repository.config().futureFiles, {});
    assert.equal(uploads.length, 1);
    assert.equal(repository.pending(), 0);
  } finally { database.close(); }
});
