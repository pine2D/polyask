import assert from "node:assert/strict";
import test from "node:test";

import { ArchiveService } from "../src/main/archive-service";
import { DesktopDatabase } from "../src/main/database";
import { HistoryService } from "../src/main/history-service";
import { PromptLibraryService } from "../src/main/prompt-library-service";
import { SyncRepository } from "../src/main/sync-repository";
import { SyncEngine, type SyncDrive } from "../src/main/sync-engine";
import { WorkspaceService } from "../src/main/workspace-service";
import { mergeStateFragments, type StateFragment } from "../src/shared/sync";

test("legacy local edits and deletes advance past imported future versions", () => {
  const db = DesktopDatabase.open(":memory:");
  db.meta.put("deviceId", "local");
  const sync = new SyncRepository(db);
  const history = new HistoryService(db.history, { deviceId: () => "local", now: () => 100 });
  const archives = new ArchiveService(db.archives, { deviceId: () => "local", now: () => 100, createId: () => "archive" });
  const templates = new PromptLibraryService(db.state, db.meta, history, { now: () => 100, createId: () => "template" });
  const workspace = new WorkspaceService(db.state, db.meta, () => undefined, { now: () => 100, createId: () => "group" });
  try {
    const archive = archives.add({ text: "Question", task: "Question", results: [] });
    db.archives.put({ ...archive, updatedAt: 10_000, deviceId: "remote" }, false);
    assert.equal(archives.update(archive.id, { note: "local edit" }).updatedAt, 10_001);
    archives.delete(archive.id);
    const deletedArchive = db.archives.get(archive.id)!;
    assert.ok("deletedAt" in deletedArchive);
    assert.equal(deletedArchive.updatedAt, 10_002);

    const firstHistory = history.record("Question");
    db.history.put({ ...firstHistory, updatedAt: 10_000, lastUsedAt: 10_000, deviceId: "remote" }, false);
    const repeated = history.record("Question");
    assert.equal(repeated.updatedAt, 10_001);
    assert.equal(repeated.lastUsedAt, 10_001);
    assert.equal(db.history.delete(firstHistory.id, 100, "local")?.updatedAt, 10_002);

    db.state.put("template:template", { id: "template", name: "Remote", text: "Remote", updatedAt: 10_000, deviceId: "remote" }, 10_000, false);
    assert.equal(templates.save({ id: "template", name: "Local", text: "Local" }).updatedAt, 10_001);
    assert.equal(templates.delete("template").updatedAt, 10_002);

    db.state.put("group:group", { id: "group", name: "Remote", sites: ["claude"], updatedAt: 10_000, deviceId: "remote" }, 10_000, false);
    assert.equal(workspace.saveGroup({ id: "group", name: "Local", sites: ["kimi"] }).updatedAt, 10_001);
    assert.equal(workspace.deleteGroup("group").updatedAt, 10_002);

    db.state.put("workspace", { selectedSites: ["claude"], tier: null, updatedAt: 10_000, deviceId: "remote" }, 10_000, false);
    workspace.setTier("think");
    assert.equal(db.state.get<{ updatedAt: number }>("workspace")?.updatedAt, 10_001);
    workspace.setSelection(["kimi"]);
    assert.equal(db.state.get<{ updatedAt: number }>("workspace")?.updatedAt, 10_002);
    assert.equal(sync.pending() > 0, true);
  } finally { db.close(); }
});

test("state tombstones win exact version ties in both input orders", () => {
  const live: StateFragment = { schema: 1, deviceId: "same", settings: {}, templates: {
    t: { id: "t", name: "Name", text: "Prompt", updatedAt: 10, deviceId: "same" }
  }, groups: { g: { id: "g", updatedAt: 10, deviceId: "same" } } };
  const dead: StateFragment = { schema: 1, deviceId: "same", settings: {}, templates: {
    t: { id: "t", updatedAt: 10, deletedAt: 10, deviceId: "same" }
  }, groups: { g: { id: "g", updatedAt: 10, deletedAt: 10, deviceId: "same" } } };
  for (const fragments of [[live, dead], [dead, live], [live, dead, live]]) {
    const merged = mergeStateFragments(fragments);
    assert.deepEqual(merged.templates, []);
    assert.deepEqual(merged.groups, []);
    assert.equal(merged.materialized.templates.t.deletedAt, 10);
    assert.equal(merged.materialized.groups.g.deletedAt, 10);
  }
});

test("archive tombstone wins an exact version tie and stays deleted on repeat import", () => {
  const db = DesktopDatabase.open(":memory:");
  db.meta.put("deviceId", "same");
  const service = new ArchiveService(db.archives, { deviceId: () => "same", now: () => 10, createId: () => "a" });
  const sync = new SyncRepository(db);
  try {
    const live = service.add({ text: "Question", task: "Question", results: [] });
    const dead = { schema: 1 as const, id: live.id, createdAt: live.createdAt, updatedAt: 10, deletedAt: 10, deviceId: "same" };
    assert.equal(sync.importArchive(dead), true);
    assert.equal(service.get(live.id), null);
    assert.equal(sync.importArchive(live), true);
    assert.equal(service.get(live.id), null);
  } finally { db.close(); }
});

test("template deletion survives an equal cloud version and reaches the uploaded state body", async () => {
  const db = DesktopDatabase.open(":memory:");
  db.meta.put("deviceId", "local");
  const history = new HistoryService(db.history, { deviceId: () => "local" });
  const service = new PromptLibraryService(db.state, db.meta, history, { now: () => 10, createId: () => "t" });
  const sync = new SyncRepository(db);
  const saved = service.save({ name: "Name", text: "Prompt" });
  const deleted = service.delete(saved.id);
  let remote: StateFragment = { schema: 1, deviceId: "local", settings: {}, groups: {}, templates: {
    t: { ...saved, updatedAt: deleted.updatedAt }
  } };
  const file = { id: "state-file", appProperties: { app: "polyask", schema: "1", kind: "state", id: "local" } };
  const uploads: StateFragment[] = [];
  const drive: SyncDrive = {
    getStartToken: async () => "start",
    listFiles: async () => [file],
    listChanges: async () => ({ changes: [{ fileId: file.id, file }], newStartPageToken: "next" }),
    download: async () => remote,
    upsert: async (_id, _name, _properties, body) => {
      remote = body as StateFragment;
      uploads.push(remote);
      return file;
    },
    clearAll: async () => undefined
  };
  sync.saveConfig({ connected: true });
  try {
    const engine = new SyncEngine({ repository: sync, drive, now: () => 100, auth: {
      configured: () => true, securePersistence: () => true,
      connect: async () => undefined, disconnect: async () => undefined
    } });
    assert.equal((await engine.syncNow()).state, "idle");
    assert.equal(uploads.length, 1);
    assert.equal(uploads[0].templates.t.deletedAt, deleted.updatedAt);
    assert.deepEqual(service.getState().templates, []);
    assert.equal((await engine.syncNow()).state, "idle");
    assert.equal(uploads.length, 1);
    assert.equal(sync.pending(), 0);
  } finally { db.close(); }
});

test("question and legacy history search find non-ASCII case variants", () => {
  const db = DesktopDatabase.open(":memory:");
  try {
    db.questions.put({ schema: 4, id: "q", text: "ÄPFEL", createdAt: 10, updatedAt: 10, deviceId: "local", sites: ["claude"], requestedTier: null, inputImageCount: 0 });
    const history = new HistoryService(db.history, { deviceId: () => "local", now: () => 20 });
    history.record("ÄPFEL legacy");
    assert.deepEqual(db.questions.search({ query: "ÄPFEL" }).items.map((item) => item.id), ["q"]);
    assert.deepEqual(db.questions.search({ query: "äpfel" }).items.map((item) => item.id), ["q"]);
    assert.deepEqual(db.questions.legacy({ query: "ÄPFEL" }).items.map((item) => item.text), ["ÄPFEL legacy"]);
    assert.deepEqual(db.questions.legacy({ query: "äpfel" }).items.map((item) => item.text), ["ÄPFEL legacy"]);
  } finally { db.close(); }
});

test("question search folds Turkish I variants and canonical accents without changing cursor order", () => {
  const db = DesktopDatabase.open(":memory:");
  try {
    const makeQuestion = (id: string, text: string, time: number) => ({
      schema: 4 as const, id, text, createdAt: time, updatedAt: time,
      deviceId: "local", sites: ["claude" as const], requestedTier: null, inputImageCount: 0
    });
    db.questions.put(makeQuestion("older", "İSTANBUL ÄPFEL 中文", 10));
    db.questions.put(makeQuestion("newer", "IĞDIR A\u0308PFEL 中文", 20));
    const first = db.questions.search({ query: "äpfel 中文", limit: 1 });
    assert.deepEqual(first.items.map((item) => item.id), ["newer"]);
    assert.ok(first.cursor);
    assert.deepEqual(db.questions.search({ query: "äpfel 中文", limit: 1, cursor: first.cursor }).items.map((item) => item.id), ["older"]);
    assert.deepEqual(db.questions.search({ query: "istanbul" }).items.map((item) => item.id), ["older"]);
    assert.deepEqual(db.questions.search({ query: "ığdır" }).items.map((item) => item.id), ["newer"]);
    const history = new HistoryService(db.history, { deviceId: () => "local", now: () => 30 });
    history.record("İSTANBUL legacy");
    assert.deepEqual(db.questions.legacy({ query: "istanbul" }).items.map((item) => item.text), ["İSTANBUL legacy"]);
  } finally { db.close(); }
});
