import assert from "node:assert/strict";
import test from "node:test";
import { DesktopDatabase } from "../src/main/database";
import { SyncRepository } from "../src/main/sync-repository";
import { SyncEngine, type SyncDrive } from "../src/main/sync-engine";

const settle = () => new Promise<void>((resolve) => setImmediate(resolve));
function fixture() {
  const database = DesktopDatabase.open(":memory:");
  database.meta.put("deviceId", "timer-device");
  const repository = new SyncRepository(database);
  repository.saveConfig({ connected: true, pageToken: "current" });
  let uploads = 0;
  let pulls = 0;
  const drive: SyncDrive = {
    getStartToken: async () => "start", listFiles: async () => [],
    listChanges: async () => { pulls++; return { changes: [], newStartPageToken: "next" }; },
    download: async () => null,
    upsert: async () => { uploads++; return { id: "uploaded" }; },
    clearAll: async () => undefined
  };
  const engine = new SyncEngine({ repository, drive, auth: {
    configured: () => true, securePersistence: () => true,
    connect: async () => undefined, disconnect: async () => undefined
  } });
  return { database, repository, drive, engine, uploads: () => uploads, pulls: () => pulls };
}

test("future outbox work stays waiting and wakes at its earliest deadline", async (t) => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout", "setInterval"], now: 1000 });
  const f = fixture();
  try {
    f.repository.enqueue({ key: "state", kind: "state", nextAt: 31000, attempt: 0 });
    f.engine.start(); await settle();
    assert.equal(f.engine.status().state, "waiting");
    t.mock.timers.tick(29999); await settle();
    assert.equal(f.uploads(), 0);
    t.mock.timers.tick(1); await settle();
    assert.equal(f.uploads(), 1);
    assert.equal(f.engine.status().state, "idle");
  } finally { f.engine.dispose(); f.database.close(); }
});

test("continuous local writes cannot postpone a scheduled retry", async (t) => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout", "setInterval"], now: 1000 });
  const f = fixture();
  try {
    f.engine.start(); await settle();
    for (let i = 0; i < 4; i++) {
      f.repository.enqueue({ key: "state", kind: "state", nextAt: 0, attempt: 0 });
      t.mock.timers.tick(1000); await settle();
    }
    assert.ok(f.uploads() > 0);
  } finally { f.engine.dispose(); f.database.close(); }
});

test("rate limiting wakes at nextAt without three-second polling", async (t) => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout", "setInterval"], now: 1000 });
  const f = fixture(); let attempts = 0;
  f.drive.upsert = async () => {
    if (++attempts === 1) throw Object.assign(new Error("rate_limited"), { code: "rate_limited", retryAfter: 30000 });
    return { id: "uploaded" };
  };
  try {
    f.repository.enqueue({ key: "state", kind: "state", nextAt: 0, attempt: 0 });
    f.engine.start(); await settle();
    t.mock.timers.tick(3000); await settle();
    assert.equal(f.engine.status().state, "waiting");
    assert.equal(f.pulls(), 1);
    t.mock.timers.tick(27000); await settle();
    assert.equal(attempts, 2);
  } finally { f.engine.dispose(); f.database.close(); }
});

for (const action of ["dispose", "disconnect"] as const) {
  test(`${action} invalidates already queued syncs and timers`, async (t) => {
    t.mock.timers.enable({ apis: ["Date", "setTimeout", "setInterval"], now: 1000 });
    const f = fixture();
    try {
      f.engine.start(); await settle();
      f.repository.enqueue({ key: "state", kind: "state", nextAt: 30000, attempt: 0 });
      const queued = f.engine.syncNow();
      await f.engine[action](); await queued;
      t.mock.timers.tick(900000); await settle();
      assert.equal(f.pulls(), 1);
      assert.equal(f.uploads(), 0);
    } finally { f.engine.dispose(); f.database.close(); }
  });
}

test("failed old upload cannot overwrite a newer queued revision", async () => {
  const f = fixture();
  let attempts = 0;
  f.drive.upsert = async () => {
    attempts++;
    f.repository.enqueue({ key: "state", kind: "state", nextAt: Date.now() + 60000, attempt: 0 });
    throw Object.assign(new Error("rate_limited"), { code: "rate_limited", retryAfter: 30000 });
  };
  try {
    const old = f.repository.enqueue({ key: "state", kind: "state", nextAt: 0, attempt: 0 });
    await f.engine.syncNow();
    const [current] = f.repository.ready(Date.now() + 120000);
    assert.equal(current.revision, old.revision + 1);
    assert.equal(current.attempt, 0);
    assert.equal(attempts, 1);
  } finally { f.engine.dispose(); f.database.close(); }
});

test("disconnect during a slow pull prevents uploading pending local data", async () => {
  const f = fixture();
  let release!: () => void;
  f.drive.listChanges = () => new Promise((resolve) => {
    release = () => resolve({ changes: [], newStartPageToken: "next" });
  });
  try {
    f.repository.enqueue({ key: "state", kind: "state", nextAt: 0, attempt: 0 });
    const running = f.engine.syncNow(); await settle();
    const queued = f.engine.syncNow();
    const disconnected = f.engine.disconnect();
    release();
    await Promise.all([running, queued, disconnected]);
    assert.equal(f.uploads(), 0);
    assert.equal(f.repository.pending(), 1);
    assert.equal(f.engine.status().connected, false);
  } finally { f.engine.dispose(); f.database.close(); }
});

test("a concurrent edit during a throttled upload cannot create an immediate retry loop", async () => {
  const f = fixture(); let attempts = 0;
  f.drive.upsert = async () => {
    attempts++;
    f.repository.enqueue({ key: "state", kind: "state", nextAt: 0, attempt: 0 });
    throw Object.assign(new Error("stop"), { code: attempts === 1 ? "rate_limited" : "network_error" });
  };
  try {
    f.repository.enqueue({ key: "state", kind: "state", nextAt: 0, attempt: 0 });
    await f.engine.syncNow();
    assert.equal(attempts, 1);
    assert.equal(f.engine.status().state, "waiting");
  } finally { f.engine.dispose(); f.database.close(); }
});

for (const code of ["rate_limited", "server_error", "network_error", "network_timeout"]) {
  test(`a due outbox recovers after pull ${code} using backoff`, async (t) => {
    t.mock.timers.enable({ apis: ["Date", "setTimeout", "setInterval"], now: 1000 });
    const f = fixture(); let pulls = 0;
    f.drive.listChanges = async () => {
      if (++pulls === 2) throw Object.assign(new Error(code), { code, retryAfter: 30000 });
      return { changes: [], newStartPageToken: "next" };
    };
    try {
      f.repository.enqueue({ key: "state", kind: "state", nextAt: 31000, attempt: 0 });
      f.engine.start(); await settle();
      t.mock.timers.tick(30000); await settle();
      assert.equal(pulls, 2);
      t.mock.timers.tick(29999); await settle();
      assert.equal(pulls, 2, "backoff must prevent premature polling");
      t.mock.timers.tick(1); await settle();
      assert.equal(pulls, 3);
      assert.equal(f.uploads(), 1);
      assert.equal(f.engine.status().state, "idle");
    } finally { f.engine.dispose(); f.database.close(); }
  });
}

for (const code of ["unauthorized", "forbidden"]) {
  test(`pull ${code} does not schedule automatic retries`, async (t) => {
    t.mock.timers.enable({ apis: ["Date", "setTimeout", "setInterval"], now: 1000 });
    const f = fixture(); let pulls = 0;
    f.drive.listChanges = async () => { pulls++; throw Object.assign(new Error(code), { code }); };
    try {
      f.repository.enqueue({ key: "state", kind: "state", nextAt: 0, attempt: 0 });
      f.engine.start(); await settle();
      f.repository.enqueue({ key: "state", kind: "state", nextAt: 0, attempt: 0 });
      t.mock.timers.tick(60000); await settle();
      assert.equal(pulls, 1);
    } finally { f.engine.dispose(); f.database.close(); }
  });
}

test("disconnect clears session backoff before a new connection", async () => {
  const f = fixture(); let attempts = 0;
  f.drive.upsert = async () => {
    if (++attempts === 1) throw Object.assign(new Error("rate_limited"), { code: "rate_limited", retryAfter: 60000 });
    return { id: "uploaded" };
  };
  try {
    f.repository.enqueue({ key: "state", kind: "state", nextAt: 0, attempt: 0 });
    await f.engine.syncNow();
    await f.engine.disconnect();
    await f.engine.connect();
    assert.equal(attempts, 2);
    assert.equal(f.engine.status().pending, 0);
  } finally { f.engine.dispose(); f.database.close(); }
});

test("repeated pull failures back off beyond the local edit window", async (t) => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout", "setInterval"], now: 1000 });
  t.mock.method(Math, "random", () => 0.5);
  const f = fixture(); let pulls = 0;
  f.drive.listChanges = async () => { pulls++; throw Object.assign(new Error("server_error"), { code: "server_error" }); };
  try {
    f.repository.enqueue({ key: "state", kind: "state", nextAt: 0, attempt: 0 });
    f.engine.start(); await settle();
    for (const delay of [5000, 5000, 8000]) {
      const before = pulls;
      f.repository.enqueue({ key: "state", kind: "state", nextAt: 0, attempt: 0 });
      t.mock.timers.tick(delay - 1); await settle();
      assert.equal(pulls, before);
      t.mock.timers.tick(1); await settle();
      assert.equal(pulls, before + 1);
    }
  } finally { f.engine.dispose(); f.database.close(); }
});

test("periodic sync respects a longer pull Retry-After", async (t) => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout", "setInterval"], now: 1000 });
  const f = fixture(); let pulls = 0;
  f.drive.listChanges = async () => {
    pulls++;
    throw Object.assign(new Error("rate_limited"), { code: "rate_limited", retryAfter: 3600000 });
  };
  try {
    f.repository.enqueue({ key: "state", kind: "state", nextAt: 0, attempt: 0 });
    f.engine.start(); await settle();
    t.mock.timers.tick(900000); await settle();
    assert.equal(pulls, 1);
  } finally { f.engine.dispose(); f.database.close(); }
});

for (const code of ["rate_limited", "server_error"]) {
  test(`upload ${code} stops all remaining batches until Retry-After`, async (t) => {
    t.mock.timers.enable({ apis: ["Date", "setTimeout", "setInterval"], now: 1000 });
    const f = fixture(); let attempts = 0;
    f.drive.upsert = async (_id, name, appProperties) => {
      if (++attempts === 1) throw Object.assign(new Error(code), { code, retryAfter: 30000 });
      return { id: name, appProperties };
    };
    try {
      f.repository.enqueue({ key: "state", kind: "state", nextAt: 0, attempt: 0 });
      f.database.history.put({
        schema: 1, id: "history", textHash: "history", text: "question", preview: "question",
        createdAt: 1000, lastUsedAt: 1000, updatedAt: 1000, deviceId: "timer-device"
      });
      f.engine.start(); await settle();
      assert.equal(attempts, 1, "later entity batches must not upload after throttling");
      assert.equal(f.repository.pending(), 2);
      t.mock.timers.tick(29999); await settle();
      assert.equal(attempts, 1);
      t.mock.timers.tick(1); await settle();
      assert.equal(attempts, 3);
      assert.equal(f.repository.pending(), 0);
    } finally { f.engine.dispose(); f.database.close(); }
  });
}
