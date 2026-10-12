import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { DesktopDatabase } from "../src/main/database";
import { PreferencesRepository } from "../src/main/preferences-repository";
import {
  classifyProxyInputs, PROXY_ACCEPTED_KEY, PROXY_FOLLOWING_KEY, PROXY_OVERRIDE_KEY, PROXY_STATE_KEY,
  ProxyPreferenceStore, type ProxyInputs, type Tagged
} from "../src/main/proxy-preference-store";
import { resolveProxyTarget, type VersionedProxy } from "../src/main/proxy-target";
import { DEFAULT_PROXY_PREFERENCE, type ProxyPreference } from "../src/shared/proxy-preference";

function proxy(patch: Partial<ProxyPreference> = {}): ProxyPreference {
  return { version: 1, mode: "custom", scheme: "http", host: "proxy-a.example", port: 7890, bypass: [], username: "", ...patch };
}

const P1 = proxy();
const P2 = proxy({ host: "proxy-b.example" });
const ABSENT = { kind: "absent" } as const;
const INVALID = { kind: "invalid" } as const;
const BLOCKED = { kind: "blocked", reason: "stored_invalid" } as const;
const ok = <T>(value: T): Tagged<T> => ({ kind: "ok", value });

function raw(database: DesktopDatabase): DatabaseSync {
  return (database as unknown as { database: DatabaseSync }).database;
}

function open(path = ":memory:", deviceId: string | null = "device-a", now = 1_000) {
  const database = DesktopDatabase.open(path);
  if (deviceId) database.meta.put("deviceId", deviceId);
  // 不传 deviceId：走默认实现（读 meta.deviceId），与生产装配一致。
  const store = new ProxyPreferenceStore(database, { now: () => now });
  return { database, store };
}

function resolveStored(store: ProxyPreferenceStore) {
  const classified = classifyProxyInputs(store.read());
  return classified.kind === "blocked" ? classified : { kind: "resolve" as const, ...resolveProxyTarget(classified.input) };
}

function withProfile(run: (path: string) => void): void {
  const directory = mkdtempSync(join(tmpdir(), "polyask-proxy-store-"));
  try { run(join(directory, "polyask.sqlite")); }
  finally { rmSync(directory, { recursive: true, force: true }); }
}

test("an empty profile without a deviceId reads absent inputs and resolves to system without throwing", () => {
  const { database, store } = open(":memory:", null);
  try {
    assert.equal(database.meta.get("deviceId"), null);
    assert.deepEqual(store.read(), { following: ABSENT, override: ABSENT, shared: ABSENT, accepted: ABSENT });
    const classified = classifyProxyInputs(store.read());
    assert.equal(classified.kind, "resolve");
    if (classified.kind !== "resolve") return;
    assert.equal(classified.sharedInvalid, false);
    assert.deepEqual(resolveProxyTarget(classified.input),
      { target: DEFAULT_PROXY_PREFERENCE, pendingConfirm: null, nextAccepted: null });
  } finally { database.close(); }
});

test("repositories tell an absent row from a row whose body no longer parses", () => {
  const { database } = open();
  try {
    assert.equal(database.meta.has(PROXY_OVERRIDE_KEY), false);
    assert.equal(database.state.has(PROXY_STATE_KEY), false);
    database.meta.put(PROXY_OVERRIDE_KEY, P1);
    database.state.put(PROXY_STATE_KEY, { value: P1, updatedAt: 5, deviceId: "device-b" }, 5, false);
    assert.equal(database.meta.has(PROXY_OVERRIDE_KEY), true);
    assert.equal(database.state.has(PROXY_STATE_KEY), true);
    raw(database).prepare("UPDATE meta SET body = ? WHERE key = ?").run("{", PROXY_OVERRIDE_KEY);
    assert.equal(database.meta.get(PROXY_OVERRIDE_KEY), null);
    assert.equal(database.meta.has(PROXY_OVERRIDE_KEY), true);
  } finally { database.close(); }
});

test("read tags well-formed values ok and every malformed stored value invalid", () => {
  const { database, store } = open();
  try {
    const versioned: VersionedProxy = { value: P2, updatedAt: 50, deviceId: "device-b" };
    database.meta.put(PROXY_FOLLOWING_KEY, true);
    database.meta.put(PROXY_OVERRIDE_KEY, P1);
    database.meta.put(PROXY_ACCEPTED_KEY, P2);
    database.state.put(PROXY_STATE_KEY, versioned, 50, false);
    assert.deepEqual(store.read(), { following: ok(true), override: ok(P1), shared: ok(versioned), accepted: ok(P2) });

    database.meta.put(PROXY_FOLLOWING_KEY, "true");
    database.meta.put(PROXY_OVERRIDE_KEY, { ...P1, host: "PROXY-A.example" });
    database.meta.put(PROXY_ACCEPTED_KEY, { ...P2, extra: 1 });
    database.state.put(PROXY_STATE_KEY, { ...versioned, value: { ...P2, port: 0 } }, 50, false);
    assert.deepEqual(store.read(), { following: INVALID, override: INVALID, shared: INVALID, accepted: INVALID });

    database.meta.put(PROXY_FOLLOWING_KEY, null);
    raw(database).prepare("UPDATE meta SET body = ? WHERE key = ?").run("{oops", PROXY_OVERRIDE_KEY);
    raw(database).prepare("UPDATE state_items SET body = ? WHERE key = ?").run("[", PROXY_STATE_KEY);
    assert.deepEqual(store.read(), { following: INVALID, override: INVALID, shared: INVALID, accepted: INVALID });

    database.state.put(PROXY_STATE_KEY, { ...versioned, deletedAt: 60 }, 60, false);
    assert.deepEqual(store.read().shared, INVALID);
  } finally { database.close(); }
});

test("classification blocks every corrupt combination listed in §3.3 and resolves the rest", () => {
  const inputs = (patch: Partial<ProxyInputs>): ProxyInputs =>
    ({ following: ABSENT, override: ABSENT, shared: ABSENT, accepted: ABSENT, ...patch });
  const versioned: VersionedProxy = { value: P2, updatedAt: 9, deviceId: "device-b" };

  assert.deepEqual(classifyProxyInputs(inputs({ following: INVALID })), BLOCKED);
  assert.deepEqual(classifyProxyInputs(inputs({ following: INVALID, override: ok(P1), accepted: ok(P1) })), BLOCKED);
  assert.deepEqual(classifyProxyInputs(inputs({ override: INVALID })), BLOCKED);
  assert.deepEqual(classifyProxyInputs(inputs({ following: ok(false), override: INVALID })), BLOCKED);
  assert.deepEqual(classifyProxyInputs(inputs({ following: ok(true), accepted: INVALID, override: ok(P1) })), BLOCKED);
  assert.deepEqual(classifyProxyInputs(inputs({ following: ok(true) })), BLOCKED);
  assert.deepEqual(classifyProxyInputs(inputs({ following: ok(true), override: INVALID })), BLOCKED);

  assert.deepEqual(classifyProxyInputs(inputs({ following: ok(false), override: ok(P1), accepted: INVALID, shared: INVALID })),
    { kind: "resolve", sharedInvalid: true, input: { following: false, override: P1, shared: null, accepted: null } });
  assert.deepEqual(classifyProxyInputs(inputs({ following: ok(true), override: ok(P1) })),
    { kind: "resolve", sharedInvalid: false, input: { following: true, override: P1, shared: null, accepted: null } });
  assert.deepEqual(classifyProxyInputs(inputs({ following: ok(true), accepted: ok(P1), override: INVALID, shared: INVALID })),
    { kind: "resolve", sharedInvalid: true, input: { following: true, override: null, shared: null, accepted: P1 } });
  assert.deepEqual(classifyProxyInputs(inputs({ following: ok(true), accepted: ok(P1), shared: ok(versioned) })),
    { kind: "resolve", sharedInvalid: false, input: { following: true, override: null, shared: versioned, accepted: P1 } });
});

test("saving while not following writes only the local override and never uploads", () => {
  const { database, store } = open();
  try {
    assert.equal(store.save(P1), "local");
    assert.deepEqual(database.meta.get(PROXY_OVERRIDE_KEY), P1);
    assert.equal(database.meta.has(PROXY_FOLLOWING_KEY), false);
    assert.equal(database.state.has(PROXY_STATE_KEY), false);
    assert.equal(database.outbox.count(), 0);
    store.saveLocal(P2);
    assert.deepEqual(database.meta.get(PROXY_OVERRIDE_KEY), P2);
    assert.equal(database.outbox.count(), 0);
    assert.throws(() => store.save({ ...P1, host: "PROXY.example" }), /proxy_invalid/);
    assert.throws(() => store.saveLocal({ ...P1, port: 0 }), /proxy_invalid/);
    assert.deepEqual(database.meta.get(PROXY_OVERRIDE_KEY), P2);
  } finally { database.close(); }
});

test("saving while following writes shared to the outbox and accepted together", () => {
  const { database, store } = open(":memory:", "device-a", 1_000);
  try {
    database.meta.put(PROXY_FOLLOWING_KEY, true);
    database.meta.put(PROXY_OVERRIDE_KEY, P2);
    assert.equal(store.save(P1), "following");
    assert.deepEqual(database.state.get(PROXY_STATE_KEY), { value: P1, updatedAt: 1_000, deviceId: "device-a" });
    assert.deepEqual(database.meta.get(PROXY_ACCEPTED_KEY), P1);
    assert.deepEqual(database.meta.get(PROXY_OVERRIDE_KEY), P2);
    assert.deepEqual(database.outbox.ready(10_000).map(entry => entry.key), [`state:${PROXY_STATE_KEY}`]);
    store.saveFollowing(P1);
    assert.equal((database.state.get(PROXY_STATE_KEY) as VersionedProxy).updatedAt, 1_000);
    database.state.put(PROXY_STATE_KEY, { value: P2, updatedAt: 5_000, deviceId: "device-b" }, 5_000, false);
    store.saveFollowing(P1);
    assert.deepEqual(database.state.get(PROXY_STATE_KEY), { value: P1, updatedAt: 5_001, deviceId: "device-a" });
  } finally { database.close(); }
});

test("a failing shared write rolls back every other write of the same call", () => {
  const database = DesktopDatabase.open(":memory:");
  const store = new ProxyPreferenceStore(database, { now: () => 1_000, deviceId: () => { throw new Error("device_id_missing"); } });
  try {
    database.meta.put(PROXY_FOLLOWING_KEY, true);
    assert.throws(() => store.save(P1), /device_id_missing/);
    assert.equal(database.meta.has(PROXY_ACCEPTED_KEY), false);
    assert.equal(database.state.has(PROXY_STATE_KEY), false);
    database.meta.put(PROXY_FOLLOWING_KEY, false);
    assert.throws(() => store.enableFollowing(P1, true), /device_id_missing/);
    assert.equal(database.meta.get(PROXY_FOLLOWING_KEY), false);
    assert.equal(database.meta.has(PROXY_ACCEPTED_KEY), false);
    assert.equal(database.state.has(PROXY_STATE_KEY), false);
    assert.equal(database.outbox.count(), 0);
  } finally { database.close(); }
});

test("saving locally repairs a corrupt following flag so the next start is no longer blocked", () => {
  withProfile(path => {
    const first = open(path);
    try {
      first.database.meta.put(PROXY_FOLLOWING_KEY, "yes");
      first.database.meta.put(PROXY_ACCEPTED_KEY, P2);
      assert.deepEqual(resolveStored(first.store), BLOCKED);
      assert.equal(first.store.save(P1), "local");
      assert.equal(first.database.meta.get(PROXY_FOLLOWING_KEY), false);
      assert.equal(first.database.meta.has(PROXY_ACCEPTED_KEY), false);
      assert.equal(first.database.outbox.count(), 0);
    } finally { first.database.close(); }
    const second = open(path);
    try {
      assert.deepEqual(resolveStored(second.store), { kind: "resolve", target: P1, pendingConfirm: null, nextAccepted: null });
    } finally { second.database.close(); }
  });
});

test("a corrupt proxy override or following flag survives unrelated preference writes and stays blocked after restart", () => {
  const corruptions = [[PROXY_OVERRIDE_KEY, { ...P1, port: 99_999 }], [PROXY_FOLLOWING_KEY, 1]] as const;
  for (const [key, value] of corruptions) {
    withProfile(path => {
      const first = open(path);
      try {
        first.database.meta.put(key, value);
        const preferences = new PreferencesRepository(first.database.state, first.database.meta, { now: () => 1_000 });
        preferences.set("siteZoom.kimi", 1.25);
        preferences.setFollowing("display", true);
        assert.deepEqual(first.database.meta.get(key), value);
      } finally { first.database.close(); }
      const second = open(path);
      try {
        assert.deepEqual(resolveStored(second.store), BLOCKED);
        assert.deepEqual(second.database.meta.get(key), value);
      } finally { second.database.close(); }
    });
  }
});

test("enabling following uploads the applied value only when no valid shared value exists", () => {
  const { database, store } = open(":memory:", "device-a", 2_000);
  try {
    store.enableFollowing(P1, true);
    assert.equal(database.meta.get(PROXY_FOLLOWING_KEY), true);
    assert.deepEqual(database.meta.get(PROXY_ACCEPTED_KEY), P1);
    assert.deepEqual(database.state.get(PROXY_STATE_KEY), { value: P1, updatedAt: 2_000, deviceId: "device-a" });
    assert.equal(database.outbox.count(), 1);

    const remote: VersionedProxy = { value: P2, updatedAt: 9_000, deviceId: "device-b" };
    database.state.put(PROXY_STATE_KEY, remote, 9_000, false);
    store.disableFollowing(P1);
    store.enableFollowing(P1, true);
    assert.deepEqual(database.state.get(PROXY_STATE_KEY), remote);
    assert.equal(database.outbox.count(), 1);

    store.disableFollowing(P1);
    raw(database).prepare("UPDATE state_items SET body = ? WHERE key = ?").run("{", PROXY_STATE_KEY);
    store.enableFollowing(P2, true);
    assert.deepEqual(database.state.get(PROXY_STATE_KEY), { value: P2, updatedAt: 2_000, deviceId: "device-a" });
  } finally { database.close(); }
  const other = open();
  try {
    other.store.enableFollowing(P1, false);
    assert.equal(other.database.state.has(PROXY_STATE_KEY), false);
    assert.equal(other.database.outbox.count(), 0);
    assert.deepEqual(other.database.meta.get(PROXY_ACCEPTED_KEY), P1);
  } finally { other.database.close(); }
});

test("disabling following stores the given override, deletes accepted and never copies shared", () => {
  const { database, store } = open();
  try {
    database.meta.put(PROXY_FOLLOWING_KEY, true);
    database.meta.put(PROXY_ACCEPTED_KEY, P1);
    const remote: VersionedProxy = { value: P2, updatedAt: 9_000, deviceId: "device-b" };
    database.state.put(PROXY_STATE_KEY, remote, 9_000, false);
    store.disableFollowing(P1);
    assert.equal(database.meta.get(PROXY_FOLLOWING_KEY), false);
    assert.deepEqual(database.meta.get(PROXY_OVERRIDE_KEY), P1);
    assert.equal(database.meta.has(PROXY_ACCEPTED_KEY), false);
    assert.deepEqual(database.state.get(PROXY_STATE_KEY), remote);
    assert.equal(database.outbox.count(), 0);
    assert.deepEqual(resolveStored(store), { kind: "resolve", target: P1, pendingConfirm: null, nextAccepted: null });
    assert.throws(() => store.disableFollowing({ ...P1, port: 0 }), /proxy_invalid/);
    assert.deepEqual(database.meta.get(PROXY_OVERRIDE_KEY), P1);
  } finally { database.close(); }
});

test("accepted is only recorded while following", () => {
  const { database, store } = open();
  try {
    assert.equal(store.setAccepted(P1), false);
    assert.equal(database.meta.has(PROXY_ACCEPTED_KEY), false);
    database.meta.put(PROXY_FOLLOWING_KEY, true);
    assert.equal(store.setAccepted(P2), true);
    assert.deepEqual(database.meta.get(PROXY_ACCEPTED_KEY), P2);
    assert.equal(database.outbox.count(), 0);
    assert.throws(() => store.setAccepted({ ...P2, username: "\u0001" }), /proxy_invalid/);
  } finally { database.close(); }
});

test("follow, disable, save P2 locally, follow again yields P2 or a pending confirm, never the old accepted", () => {
  const { database, store } = open(":memory:", "device-a", 3_000);
  try {
    store.enableFollowing(P1, true);
    assert.deepEqual(store.read().accepted, ok(P1));
    store.disableFollowing(P1);
    assert.equal(store.save(P2), "local");
    const inputs = store.read();
    assert.equal(inputs.accepted.kind, "absent");
    const shared = inputs.shared.kind === "ok" ? inputs.shared.value : null;
    const result = resolveProxyTarget({ following: true, override: P2, shared, accepted: null, appliedAtFollowOn: P2 });
    assert.deepEqual(result.target, P2);
    assert.equal(result.pendingConfirm?.host, "proxy-a.example");
    store.enableFollowing(result.nextAccepted ?? P2, shared === null);
    assert.deepEqual(database.meta.get(PROXY_ACCEPTED_KEY), P2);
    assert.deepEqual(resolveStored(store), {
      kind: "resolve", target: P2, nextAccepted: P2,
      pendingConfirm: { scheme: "http", host: "proxy-a.example", port: 7890, version: { updatedAt: 3_000, deviceId: "device-a" } }
    });
  } finally { database.close(); }
});

test("local reset clears every proxy row and keeps the deviceId", () => {
  const { database, store } = open();
  try {
    store.enableFollowing(P1, true);
    store.disableFollowing(P1);
    store.saveLocal(P2);
    database.meta.put(PROXY_FOLLOWING_KEY, true);
    database.meta.put(PROXY_ACCEPTED_KEY, P1);
    database.resetLocalData();
    assert.deepEqual(store.read(), { following: ABSENT, override: ABSENT, shared: ABSENT, accepted: ABSENT });
    assert.equal(database.meta.get("deviceId"), "device-a");
    assert.equal(database.outbox.count(), 0);
  } finally { database.close(); }
});
