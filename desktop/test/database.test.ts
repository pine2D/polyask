import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

import { DesktopDatabase } from "../src/main/database";
import { archiveFixture, readSource } from "./fixtures";

test("desktop database enables WAL and preserves archive tombstones across reopen", () => {
  const directory = mkdtempSync(join(tmpdir(), "polyask-database-"));
  const path = join(directory, "polyask.sqlite");
  try {
    const first = DesktopDatabase.open(path);
    assert.deepEqual(first.configuration(), { journalMode: "wal", foreignKeys: true, userVersion: 3 });
    first.archives.put(archiveFixture());
    first.archives.delete("archive-a", 2_000, "device-b");
    assert.equal(first.outbox.count(), 1);
    first.close();

    const reopened = DesktopDatabase.open(path);
    const stored = reopened.archives.get("archive-a");
    assert.ok(stored && "deletedAt" in stored);
    assert.equal(stored.deletedAt, 2_000);
    assert.equal("text" in (stored || {}), false);
    assert.equal(reopened.outbox.count(), 1);
    reopened.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("state items and history survive reopen without physical deletion", () => {
  const directory = mkdtempSync(join(tmpdir(), "polyask-database-"));
  const path = join(directory, "polyask.sqlite");
  try {
    const first = DesktopDatabase.open(path);
    first.meta.put("deviceId", "device-a");
    first.state.put("workspace", { selectedSites: ["claude"], tier: null }, 1_000);
    first.history.put({
      id: "hash-a",
      textHash: "hash-a",
      text: "Question",
      preview: "Question",
      createdAt: 1_000,
      lastUsedAt: 1_000,
      updatedAt: 1_000,
      deviceId: "device-a",
      schema: 1
    });
    first.history.delete("hash-a", 2_000, "device-b");
    first.close();

    const reopened = DesktopDatabase.open(path);
    assert.equal(reopened.meta.get("deviceId"), "device-a");
    assert.deepEqual(reopened.state.get("workspace"), { selectedSites: ["claude"], tier: null });
    const history = reopened.history.get("hash-a");
    assert.ok(history && "deletedAt" in history);
    assert.equal(history.deletedAt, 2_000);
    reopened.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("state repository lists a prefix without folding distinct outbox operations", () => {
  const database = DesktopDatabase.open(":memory:");
  try {
    database.state.put("group:a", { id: "a" }, 1_000);
    database.state.put("group:b", { id: "b" }, 2_000);
    database.state.put("workspace", { selectedSites: [] }, 3_000);

    assert.deepEqual(database.state.list<{ id: string }>("group:"), [{ id: "b" }, { id: "a" }]);
    assert.equal(database.outbox.count(), 3);
  } finally {
    database.close();
  }
});

test("a copied profile rekeys pending history without taking over the old Drive file", () => {
  const database = DesktopDatabase.open(":memory:");
  try {
    database.meta.put("deviceId", "device-old");
    database.history.put({
      id: "history-a",
      textHash: "history-a",
      text: "Question",
      preview: "Question",
      createdAt: 1_000,
      lastUsedAt: 1_000,
      updatedAt: 1_000,
      deviceId: "device-old",
      schema: 1
    });
    database.driveFiles.put({
      id: "drive-old",
      name: "history-history-a-device-old.json",
      appProperties: { kind: "history" },
      logicalKey: "history:history-a:device-old",
      seenAt: 1_000
    });

    database.adoptImportedProfile("device-new");

    assert.equal(database.meta.get("deviceId"), "device-new");
    assert.deepEqual(database.outbox.ready(Number.MAX_SAFE_INTEGER).map((entry) => entry.key), [
      "history:history-a:device-new"
    ]);
    assert.equal(database.driveFiles.find("history:history-a:device-new"), null);
    assert.equal(database.driveFiles.find("history:history-a:device-old")?.id, "drive-old");
  } finally {
    database.close();
  }
});


test("decision migration preserves a schema 1 database and its archived JSON verbatim",()=>{
  const directory=mkdtempSync(join(tmpdir(),"polyask-v1-migration-"));
  const path=join(directory,"old.sqlite");
  try{
    const old=new DatabaseSync(path);
    old.exec("CREATE TABLE archives(id TEXT PRIMARY KEY,body TEXT NOT NULL,sort_time INTEGER NOT NULL,deleted_at INTEGER); CREATE TABLE meta(key TEXT PRIMARY KEY,body TEXT NOT NULL); PRAGMA user_version=1");
    const archive=archiveFixture();
    old.prepare("INSERT INTO archives VALUES(?,?,?,NULL)").run(archive.id,JSON.stringify(archive),archive.createdAt);
    old.prepare("INSERT INTO meta VALUES(?,?)").run("deviceId",JSON.stringify("old-device"));
    old.close();
    const migrated=DesktopDatabase.open(path);
    assert.equal(migrated.configuration().userVersion,3);
    assert.deepEqual(migrated.archives.get(archive.id),archive);
    assert.equal(migrated.meta.get("deviceId"),"old-device");
    assert.deepEqual(migrated.decisions.list(),[]);
    assert.equal(migrated.outbox.count(),0);
    migrated.close();
  }finally{rmSync(directory,{recursive:true,force:true});}
});

test("folder migration preserves schema 2 decision bodies and device identity",()=>{
  const directory=mkdtempSync(join(tmpdir(),"polyask-v2-folders-"));
  const path=join(directory,"old.sqlite");
  try {
    const decision=JSON.parse(readSource("test/fixtures/schema2-decision.json")).body;
    const old=new DatabaseSync(path);
    old.exec("CREATE TABLE decisions(id TEXT PRIMARY KEY,body TEXT NOT NULL,sort_time INTEGER NOT NULL,deleted_at INTEGER); CREATE TABLE meta(key TEXT PRIMARY KEY,body TEXT NOT NULL); PRAGMA user_version=2");
    old.prepare("INSERT INTO decisions VALUES(?,?,?,NULL)").run(decision.id,JSON.stringify(decision),decision.updatedAt);
    old.prepare("INSERT INTO meta VALUES(?,?)").run("deviceId",JSON.stringify("old-device"));
    old.close();
    const migrated=DesktopDatabase.open(path);
    assert.equal(migrated.configuration().userVersion,3);
    assert.deepEqual(migrated.decisions.get(decision.id),decision);
    assert.deepEqual(migrated.folders.list(),[]);
    assert.deepEqual(migrated.folders.listMemberships(),[]);
    assert.equal(migrated.meta.get("deviceId"),"old-device");
    assert.equal(migrated.outbox.count(),0);
    migrated.close();
  } finally {rmSync(directory,{recursive:true,force:true});}
});
