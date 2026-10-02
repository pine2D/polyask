import assert from "node:assert/strict";
import test from "node:test";

import { DesktopDatabase } from "../src/main/database";
import { SyncEngine, type SyncDrive } from "../src/main/sync-engine";
import { SyncRepository } from "../src/main/sync-repository";
import { createArchiveRecord, type StoredArchive } from "../src/shared/archive";
import { questionAnswerFixture, questionFixture } from "./question-fixtures";
import { readSource } from "./fixtures";
import type { DecisionRecord } from "../src/shared/decision";

test("a delayed older archive upload is repaired and a third device converges", async () => {
  const databases: DesktopDatabase[] = [];
  let cloud: { file: { id: string; appProperties: Record<string, string> }; body: StoredArchive } | null = null;
  const cloudVersion = () => cloud?.body.updatedAt;
  let releaseOlder!: () => void;
  let olderStarted!: () => void;
  const olderGate = new Promise<void>((resolve) => { releaseOlder = resolve; });
  const olderEntered = new Promise<void>((resolve) => { olderStarted = resolve; });
  let delayOlder = true;
  const drive: SyncDrive = {
    getStartToken: async () => "token",
    listFiles: async () => cloud ? [cloud.file] : [],
    listChanges: async () => ({ changes: cloud ? [{ fileId: cloud.file.id, file: cloud.file }] : [], newStartPageToken: "token" }),
    download: async () => cloud ? structuredClone(cloud.body) : null,
    upsert: async (_id, _name, appProperties, body) => {
      if (delayOlder && (body as StoredArchive).deviceId === "b") {
        delayOlder = false;
        olderStarted();
        await olderGate;
      }
      cloud = { file: { id: "archive-file", appProperties }, body: structuredClone(body as StoredArchive) };
      return cloud.file;
    },
    clearAll: async () => undefined
  };
  const makeDevice = (deviceId: string) => {
    const db = DesktopDatabase.open(":memory:");
    databases.push(db);
    db.meta.put("deviceId", deviceId);
    const repository = new SyncRepository(db);
    repository.saveConfig({ connected: true });
    const engine = new SyncEngine({ repository, drive, now: () => 1_000, auth: {
      configured: () => true, securePersistence: () => true,
      connect: async () => undefined, disconnect: async () => undefined
    } });
    return { db, repository, engine };
  };
  const a = makeDevice("a"), b = makeDevice("b"), c = makeDevice("c");
  const base = createArchiveRecord({ text: "Question", task: "Question", results: [] }, { id: "shared", now: 100, deviceId: "a" });
  a.db.archives.put({ ...base, note: "newer", updatedAt: 300, deviceId: "a", searchText: "question\nnewer" });
  b.db.archives.put({ ...base, note: "older", updatedAt: 200, deviceId: "b", searchText: "question\nolder" });
  try {
    const delayed = b.engine.syncNow();
    await olderEntered;
    assert.equal((await a.engine.syncNow()).state, "idle");
    releaseOlder();
    assert.equal((await delayed).state, "idle");
    assert.equal(cloudVersion(), 200);
    assert.equal((await a.engine.syncNow()).state, "idle");
    assert.equal(cloudVersion(), 300);
    assert.equal((await b.engine.syncNow()).state, "idle");
    assert.equal((await c.engine.syncNow()).state, "idle");
    for (const device of [a, b, c]) {
      assert.equal(device.repository.archive("shared")?.updatedAt, 300);
      assert.equal(device.repository.pending(), 0);
    }
    assert.equal((await a.engine.syncNow()).state, "idle");
    assert.equal(a.repository.pending(), 0);
  } finally {
    releaseOlder();
    for (const db of databases) db.close();
  }
});

test("older decision, question and answer imports enqueue their retained local winners once", () => {
  const db = DesktopDatabase.open(":memory:");
  db.meta.put("deviceId", "local");
  const sync = new SyncRepository(db);
  try {
    const decision = JSON.parse(readSource("test/fixtures/schema2-decision.json")).body as DecisionRecord;
    const newestDecision = { ...decision, updatedAt: decision.updatedAt + 20 };
    db.decisions.put(newestDecision, false);
    assert.equal(sync.importDecision({ ...decision, updatedAt: decision.updatedAt + 10 }), true);
    assert.equal(sync.decision(decision.id)?.updatedAt, newestDecision.updatedAt);

    const question = { ...questionFixture(), updatedAt: 30 };
    const answer = { ...questionAnswerFixture(), updatedAt: 30 };
    db.questions.put(question, false);
    db.questions.putAnswer(answer, false);
    assert.equal(sync.importQuestion({ ...question, updatedAt: 20 }), true);
    assert.equal(sync.importQuestionAnswer({ ...answer, updatedAt: 20 }), true);
    assert.equal(sync.pending(), 3);

    for (const operation of sync.ready(0)) assert.equal(sync.complete(operation.key, operation.revision), true);
    assert.equal(sync.pending(), 0);
    assert.equal(sync.importDecision(newestDecision), true);
    assert.equal(sync.importQuestion(question), true);
    assert.equal(sync.importQuestionAnswer(answer), true);
    assert.equal(sync.pending(), 0, "equal cloud copies must not cause repeated uploads");
  } finally { db.close(); }
});
