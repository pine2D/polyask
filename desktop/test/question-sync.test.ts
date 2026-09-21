import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { DesktopDatabase } from "../src/main/database";
import { SyncEngine, type SyncDrive } from "../src/main/sync-engine";
import { SyncRepository } from "../src/main/sync-repository";
import type { DriveFile } from "../src/main/drive-client";
import { BackupService } from "../src/main/backup-service";
import { questionFixture, questionAnswerFixture } from "./question-fixtures";
import { readSource } from "./fixtures";
const envelope = (body: any, kind: string) => ({file: {id: `${kind}-${body.id}`, appProperties: {app: "polyask", kind, schema: "4", id: createHash("sha256").update(body.id).digest("hex")}} as DriveFile, body});
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

test("question and answer sync round-trip with schema 4 and no text metadata", async () => {
  const source = setup();
  try {
    source.database.questions.put(questionFixture());
    source.database.questions.putAnswer(questionAnswerFixture());
    assert.equal((await source.engine.syncNow()).readOnly, false);
    assert.equal(source.uploads.length, 2);
    for (const item of source.uploads) { assert.equal(item.file.appProperties?.schema, "4"); assert.equal(item.file.appProperties?.preview, undefined); }
    const receiver = setup([...source.uploads].reverse());
    try {
      assert.equal((await receiver.engine.syncNow()).readOnly, false);
      assert.equal(receiver.database.questions.search().items.length, 1);
      assert.equal(receiver.database.questions.answers("q-a")[0].answerMarkdown, "Saved answer");
    } finally {receiver.database.close();}
  } finally {source.database.close();}
});
test("schema 4 future locks replay on upgrade and deletion wins against late answers", async () => {
  const q = questionFixture(), a = questionAnswerFixture();
  const deleted = {schema:4, id:q.id,createdAt:10,updatedAt:30,deletedAt:30,deviceId:"remote"};
  const entries = [envelope(deleted,"question"),envelope(a,"questionAnswer")];
  const s = setup(entries);
  s.repository.saveConfig({readOnly:true, pageToken:"old", futureFiles:{[entries[0].file.id]:4}});
  try {
    assert.equal((await s.engine.syncNow()).readOnly,false);
    assert.ok("deletedAt" in s.database.questions.getAnswer(a.id)!);
    assert.equal(s.scans(),1);
  } finally {s.database.close();}
});
test("backup v2 round-trips questions and attempts while refusing children without a parent", () => {
  const source=DesktopDatabase.open(":memory:"), receiver=DesktopDatabase.open(":memory:");
  try {
    source.questions.put(questionFixture()); source.questions.putAnswer(questionAnswerFixture());
    const document=new BackupService(source,{deviceId:()=>"a"}).export();
    assert.equal(document.version,2);
    assert.deepEqual(document.entries.map(e=>e.kind),["question","questionAnswer"]);
    assert.equal(JSON.stringify(document).includes("deviceId"),false);
    const service=new BackupService(receiver,{deviceId:()=>"b",now:()=>100});
    const orphan=service.preview({...document,entries:document.entries.filter(e=>e.kind==="questionAnswer")});
    assert.equal(orphan.items[0].blocked,true);
    assert.equal(service.apply(orphan.token,orphan.items.map(i=>i.key)).imported,0);
    const preview=service.preview(document);
    assert.equal(service.apply(preview.token,preview.items.map(i=>i.key)).imported,2);
    assert.equal(receiver.questions.answers("q-a")[0].answerMarkdown,"Saved answer");
    const repeat=service.preview(document);
    assert.equal(service.apply(repeat.token,repeat.items.map(i=>i.key)).imported,0);
  } finally {source.close();receiver.close();}
});

test("frozen schema 4 and backup v2 fixtures are accepted by production import", async () => {
  const entries = ["schema4-questionAnswer.json", "schema4-question.json"].map(name => JSON.parse(readSource(`test/fixtures/${name}`)));
  const s = setup(entries);
  try {
    assert.equal((await s.engine.syncNow()).readOnly, false);
    assert.equal(s.database.questions.answers("question-fixture")[0].answerMarkdown, "Saved answer.");
    const backup = new BackupService(s.database, { deviceId: () => "local" });
    assert.equal(backup.preview(JSON.parse(readSource("test/fixtures/backup-format2.json"))).items.length, 2);
  } finally { s.database.close(); }
});

test("backup restores deleted questions under a stable new identity with their selected answers", () => {
  const db = DesktopDatabase.open(":memory:");
  try {
    db.questions.put(questionFixture()); db.questions.putAnswer(questionAnswerFixture());
    const service = new BackupService(db, { deviceId: () => "local", now: () => 100 });
    const document = service.export();
    db.questions.delete("q-a", 30, "local");
    let preview = service.preview(document);
    assert.equal(service.apply(preview.token, preview.items.map(item => item.key)).imported, 2);
    const restored = db.questions.search().items[0];
    assert.notEqual(restored.id, "q-a");
    assert.equal(db.questions.answers(restored.id).length, 1);
    preview = service.preview(document);
    assert.equal(service.apply(preview.token, preview.items.map(item => item.key)).imported, 0);
    db.questions.delete(restored.id, 200, "local");
    preview = service.preview(document);
    assert.equal(service.apply(preview.token, preview.items.map(item => item.key)).imported, 0);
    assert.equal(db.questions.search().items.length, 0);
  } finally { db.close(); }
});

test('backup of a deleted child requires a cloned parent and never revives its tombstone', () => {
  const db = DesktopDatabase.open(':memory:');
  try {
    const q = questionFixture(), a = questionAnswerFixture();
    db.questions.put(q); db.questions.putAnswer(a);
    const service = new BackupService(db, { deviceId: () => 'local', now: () => 100 });
    const document = service.export();
    db.questions.putAnswer({ schema: 4, id: a.id, questionId: a.questionId, site: a.site, attempt: a.attempt, createdAt: 10, updatedAt: 30, deletedAt: 30, deviceId: 'local' });
    const preview = service.preview(document);
    assert.deepEqual(preview.items.find(i => i.kind === 'questionAnswer')?.requires, ['question:q-a']);
    assert.equal(service.apply(preview.token, preview.items.map(i => i.key)).imported, 2);
    assert.ok('deletedAt' in db.questions.getAnswer(a.id)!);
    const clone = db.questions.search().items.find(i => i.id !== q.id)!;
    assert.equal(db.questions.answers(clone.id)[0].answerMarkdown, a.answerMarkdown);
  } finally { db.close(); }
});
test('explicit backup conflict selection replaces a sealed copy and reports actual imports', () => {
  const db = DesktopDatabase.open(':memory:');
  try {
    db.questions.put(questionFixture()); db.questions.putAnswer(questionAnswerFixture());
    const service = new BackupService(db, { deviceId: () => 'local', now: () => 100 });
    const document = service.export();
    const changed = { ...document, entries: document.entries.map(e => e.kind === 'questionAnswer' ? { ...e, body: { ...e.body, answerMarkdown: 'Chosen backup answer' } } : e) };
    const preview = service.preview(changed);
    assert.equal(service.apply(preview.token, preview.items.map(i => i.key)).imported, 1);
    assert.equal(db.questions.answers('q-a')[0].answerMarkdown, 'Chosen backup answer');
  } finally { db.close(); }
});
