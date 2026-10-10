import assert from "node:assert/strict";
import test from "node:test";

import { DesktopDatabase } from "../src/main/database";
import { DriveClient, MULTIPART_BODY_LIMIT, type AccessTokenProvider } from "../src/main/drive-client";
import { SyncEngine, type SyncAuth, type SyncDrive } from "../src/main/sync-engine";
import { SyncRepository } from "../src/main/sync-repository";
import { DraftRepository } from "../src/main/draft-repository";
import { createArchiveRecord } from "../src/shared/archive";

const auth = (): SyncAuth => ({ configured: () => true, securePersistence: () => true, connect: async () => undefined, disconnect: async () => undefined });
const provider: AccessTokenProvider = { accessToken: async () => "token" };

function connected() {
  const database = DesktopDatabase.open(":memory:");
  database.meta.put("deviceId", "desktop-device");
  const repository = new SyncRepository(database);
  repository.saveConfig({ connected: true });
  return { database, repository };
}

function drive(upsert: SyncDrive["upsert"]): SyncDrive {
  return {
    getStartToken: async () => "start",
    listFiles: async () => [],
    listChanges: async () => ({ changes: [], newStartPageToken: "next" }),
    download: async () => null,
    upsert,
    clearAll: async () => undefined
  };
}

test("a permanently rejected state upload backs off alone while every other entity still uploads", async () => {
  const { database, repository } = connected();
  database.state.put("workspace", { selectedSites: ["claude"], tier: null, updatedAt: 1_000, deviceId: "desktop-device" }, 1_000);
  database.archives.put(createArchiveRecord({ text: "q", task: "q", results: [] }, { id: "arc-1", now: 10, deviceId: "desktop-device" }));
  const uploads: string[] = [];
  const engine = new SyncEngine({ repository, auth: auth(), now: () => 50_000, drive: drive(async (_id, name) => {
    uploads.push(name);
    if (name.startsWith("state-")) throw Object.assign(new Error("request_failed"), { code: "request_failed", status: 400 });
    return { id: `file-${name}` };
  }) });
  try {
    const status = await engine.syncNow();
    assert.equal(status.state, "error", "the rejected batch is still reported honestly");
    assert.ok(uploads.includes("archive-arc-1.json"), "one rejected batch must not starve the remaining batches");
    assert.equal(repository.pending(), 1, "only the rejected state row stays queued");
    assert.equal(repository.ready(50_000).length, 0, "the rejected batch carries its own backoff");
    const again = await engine.syncNow();
    assert.equal(uploads.filter((name) => name.startsWith("state-")).length, 1, "the backed-off batch is not hammered");
    assert.equal(again.state, "waiting");
  } finally { engine.dispose(); database.close(); }
});

test("an account-wide failure still stops the round instead of being isolated per batch", async () => {
  const { database, repository } = connected();
  database.archives.put(createArchiveRecord({ text: "a", task: "a", results: [] }, { id: "arc-a", now: 10, deviceId: "desktop-device" }));
  database.archives.put(createArchiveRecord({ text: "b", task: "b", results: [] }, { id: "arc-b", now: 11, deviceId: "desktop-device" }));
  let uploads = 0;
  const engine = new SyncEngine({ repository, auth: auth(), now: () => 50_000, drive: drive(async () => {
    uploads++;
    throw Object.assign(new Error("forbidden"), { code: "forbidden", status: 403, reason: "storageQuotaExceeded" });
  }) });
  try {
    const status = await engine.syncNow();
    assert.equal(status.state, "blocked");
    assert.equal(uploads, 1);
  } finally { engine.dispose(); database.close(); }
});

test("a body above the multipart limit is sent through a resumable session; small bodies stay multipart", async () => {
  const requests: { url: URL; method: string; headers: Headers; body: unknown }[] = [];
  const client = new DriveClient(provider, async (input, init) => {
    const url = new URL(String(input));
    requests.push({ url, method: String(init?.method), headers: new Headers(init?.headers), body: init?.body });
    if (url.searchParams.get("upload_id") === "session-1") return Response.json({ id: "big" }, { status: 200 });
    if (url.searchParams.get("uploadType") === "resumable") {
      return new Response(null, { status: 200, headers: { Location: "https://www.googleapis.com/upload/drive/v3/files/big?uploadType=resumable&upload_id=session-1" } });
    }
    return Response.json({ id: "small" });
  });
  const large = { text: "x".repeat(MULTIPART_BODY_LIMIT + 1) };
  assert.ok(MULTIPART_BODY_LIMIT <= 4 * 1024 * 1024, "keep at least 20% headroom under Drive's 5 MB multipart limit");

  const saved = await client.upsert("big", "state-a.json", { app: "polyask" }, large);
  assert.equal(saved.id, "big");
  const [start, put] = requests;
  assert.equal(start.method, "PATCH");
  assert.equal(start.url.pathname, "/upload/drive/v3/files/big");
  assert.equal(start.headers.get("X-Upload-Content-Type"), "application/json");
  assert.equal(Number(start.headers.get("X-Upload-Content-Length")), Buffer.byteLength(JSON.stringify(large)));
  assert.deepEqual(JSON.parse(String(start.body)), { name: "state-a.json", mimeType: "application/json", appProperties: { app: "polyask" } });
  assert.equal(put.method, "PUT");
  assert.equal(put.url.searchParams.get("upload_id"), "session-1");
  assert.equal(Buffer.from(put.body as Uint8Array).toString("utf8"), JSON.stringify(large));

  requests.length = 0;
  await client.upsert(null, "new.json", { app: "polyask" }, large);
  assert.equal(requests[0].method, "POST");
  assert.equal(requests[0].url.pathname, "/upload/drive/v3/files");
  assert.deepEqual(JSON.parse(String(requests[0].body)).parents, ["appDataFolder"]);

  requests.length = 0;
  await client.upsert("small", "small.json", { app: "polyask" }, { text: "short" });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url.searchParams.get("uploadType"), "multipart");
});

test("a state file above 5 MB reaches Drive through the real client instead of blocking every round", async () => {
  const { database, repository } = connected();
  database.meta.put("draftSyncEnabled", true);
  const drafts = new DraftRepository(database.state, database.meta);
  const chunk = "汉".repeat(170_000); // ~510 KB UTF-8 each, 11 of them exceed 5 MB
  for (let i = 0; i < 11; i++) drafts.save({ kind: "comparison", context: `archive-${i}`, title: "", content: { notes: chunk } });
  const stored = new Map<string, number>();
  const client = new DriveClient(provider, async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/changes/startPageToken")) return Response.json({ startPageToken: "start" });
    if (url.pathname.endsWith("/changes")) return Response.json({ changes: [], newStartPageToken: "next" });
    if (url.pathname === "/drive/v3/files") return Response.json({ files: [] });
    const size = init?.body instanceof Uint8Array ? init.body.byteLength : Buffer.byteLength(String(init?.body ?? ""));
    if (url.searchParams.get("uploadType") === "multipart" && size > 5 * 1024 * 1024) return new Response("{}", { status: 413 });
    if (url.searchParams.get("upload_id")) { stored.set("state", size); return Response.json({ id: "state-file" }); }
    if (url.searchParams.get("uploadType") === "resumable") {
      return new Response(null, { status: 200, headers: { Location: "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=s" } });
    }
    return Response.json({ id: "small-file" });
  });
  const engine = new SyncEngine({ repository, drive: client, auth: auth(), now: () => 50_000 });
  try {
    const status = await engine.syncNow();
    assert.equal(status.state, "idle");
    assert.ok((stored.get("state") ?? 0) > 5 * 1024 * 1024);
    assert.equal(repository.pending(), 0);
  } finally { engine.dispose(); database.close(); }
});

test("a resumable session URI outside the Drive upload endpoint is rejected before any token is sent", async () => {
  const sent: string[] = [];
  const client = new DriveClient(provider, async (input) => {
    const url = new URL(String(input));
    sent.push(url.host);
    return new Response(null, { status: 200, headers: { Location: "https://attacker.example/upload?upload_id=1" } });
  });
  await assert.rejects(() => client.upsert(null, "big.json", { app: "polyask" }, { text: "x".repeat(MULTIPART_BODY_LIMIT + 1) }),
    (error: unknown) => (error as { code?: string }).code === "invalid_response");
  assert.deepEqual(sent, ["www.googleapis.com"]);
});

test("Drive remove treats an already missing file as removed", async () => {
  const methods: string[] = [];
  const client = new DriveClient(provider, async (_input, init) => {
    methods.push(String(init?.method));
    return new Response(JSON.stringify({ error: { message: "File not found" } }), { status: 404 });
  });
  await client.remove("gone");
  assert.deepEqual(methods, ["DELETE"]);
});
