import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { DesktopDatabase } from "../src/main/database";
import { PreferencesRepository } from "../src/main/preferences-repository";
import { applyPreferences, projectPreferences } from "../src/main/sync-preferences";
import {
  DEFAULT_PREFERENCE_VALUES, GENERAL_PREFERENCE_GROUPS, isPreferenceKey, isPreferenceValue, isVersionedPreference,
  PREFERENCE_GROUPS, PREFERENCE_KEYS, preferenceGroup, type PreferenceValues
} from "../src/shared/preferences";
import { DEFAULT_PROXY_PREFERENCE, isProxyPreference, type ProxyPreference } from "../src/shared/proxy-preference";
import type { StateFragment, VersionedSyncValue } from "../src/shared/sync";
import { readSource } from "./fixtures";

// 规范形式：字段顺序固定、host 小写、http 允许用户名。
const CUSTOM: ProxyPreference = { version: 1, mode: "custom", scheme: "http", host: "proxy.example.com", port: 8080,
  bypass: ["*.corp.example.com"], username: "alice" };

function open(deviceId = "device-a") {
  const database = DesktopDatabase.open(":memory:");
  database.meta.put("deviceId", deviceId);
  return { database, preferences: new PreferencesRepository(database.state, database.meta, { now: () => 100 }) };
}

/** proxy 的四项原始存储（spec §3.3）；通用偏好路径不得改动任何一项。 */
function proxyRaw(database: DesktopDatabase) {
  return { shared: database.state.get("preference:proxy"), override: database.meta.get("proxyOverride"),
    following: database.meta.get("proxyFollowing"), accepted: database.meta.get("proxyAccepted") };
}

test("proxy is a registered preference key and group validated only in canonical form", () => {
  assert.equal(isProxyPreference(CUSTOM), true, "test value must already be canonical");
  assert.equal(isPreferenceKey("proxy"), true);
  assert.equal(PREFERENCE_KEYS.includes("proxy"), true);
  assert.equal(PREFERENCE_GROUPS.includes("proxy"), true);
  assert.equal((GENERAL_PREFERENCE_GROUPS as readonly string[]).includes("proxy"), false);
  assert.deepEqual([...GENERAL_PREFERENCE_GROUPS], ["display", "layout", "siteZoom"]);
  assert.equal(preferenceGroup("proxy"), "proxy");
  assert.equal(isPreferenceValue("proxy", DEFAULT_PROXY_PREFERENCE), true);
  assert.equal(isPreferenceValue("proxy", CUSTOM), true);
  for (const bad of [null, "system", [], { ...CUSTOM, host: "Proxy.Example.com" }, { ...CUSTOM, extra: 1 },
    { ...CUSTOM, port: 0 }, { ...CUSTOM, host: "" }]) {
    assert.equal(isPreferenceValue("proxy", bad), false, JSON.stringify(bad));
  }
  assert.equal(isVersionedPreference("proxy", { value: CUSTOM, updatedAt: 5, deviceId: "d" }), true);
  assert.equal(isVersionedPreference("proxy", { value: { ...CUSTOM, host: "PROXY.EXAMPLE.COM" }, updatedAt: 5, deviceId: "d" }), false);
  assert.equal(Object.hasOwn(DEFAULT_PREFERENCE_VALUES, "proxy"), false, "proxy never joins PreferenceValues");
});

test("generic repository writes reject the proxy key and group even while every group follows", () => {
  const { database, preferences } = open();
  try {
    for (const group of GENERAL_PREFERENCE_GROUPS) preferences.setFollowing(group, true);
    database.meta.put("proxyFollowing", true);
    const before = () => ({ raw: proxyRaw(database), outbox: database.outbox.count(),
      device: JSON.stringify(database.meta.get("devicePreferences")) });
    const expected = before();
    assert.throws(() => preferences.set("proxy", CUSTOM), /^Error: invalid_preference$/);
    assert.throws(() => preferences.set("proxy", DEFAULT_PROXY_PREFERENCE), /^Error: invalid_preference$/);
    assert.throws(() => preferences.setFollowing("proxy", true), /^Error: invalid_preference$/);
    assert.throws(() => preferences.setFollowing("proxy", false), /^Error: invalid_preference$/);
    assert.throws(() => preferences.seed({ proxy: CUSTOM } as unknown as Partial<PreferenceValues>), /^Error: invalid_preference$/);
    assert.deepEqual(before(), expected);
    assert.equal(database.state.get("preference:proxy"), null);
    assert.equal(database.outbox.ready(10_000).some(entry => entry.key === "state:preference:proxy"), false);
  } finally { database.close(); }
});

test("snapshot, seed, set and following other groups never read into or rewrite proxy storage", () => {
  const { database, preferences } = open();
  try {
    database.state.put("preference:proxy", { value: CUSTOM, updatedAt: 50, deviceId: "device-b" }, 50, false);
    database.meta.put("proxyOverride", { version: 1, mode: "custom", host: "BROKEN" });
    database.meta.put("proxyFollowing", "yes");
    database.meta.put("proxyAccepted", { broken: true });
    // 旧/坏数据把 proxy 塞进 devicePreferences：读取时忽略，下一次通用写入把它清出去。
    database.meta.put("devicePreferences", { following: { proxy: true, display: false }, overrides: { proxy: CUSTOM } });
    const raw = proxyRaw(database);
    const snapshot = preferences.snapshot();
    assert.equal(Object.hasOwn(snapshot.values, "proxy"), false);
    assert.equal(snapshot.initialized.includes("proxy"), false);
    assert.equal(Object.hasOwn(snapshot.versions, "proxy"), false);
    assert.deepEqual(snapshot.following, { display: false, layout: false, siteZoom: false, proxy: false });
    preferences.seed({ completionNotifications: true, display: { density: "comfortable", siteScale: 1 }, siteZoom: { kimi: 1.5 } });
    for (const group of GENERAL_PREFERENCE_GROUPS) {
      preferences.setFollowing(group, true);
      preferences.setFollowing(group, false);
    }
    preferences.set("siteZoom.kimi", 1.25);
    preferences.set("completionNotifications", false);
    assert.deepEqual(proxyRaw(database), raw, "corrupt proxyOverride/proxyFollowing must survive generic writes untouched");
    const device = database.meta.get<{ following: Record<string, unknown>; overrides: Record<string, unknown> }>("devicePreferences");
    assert.equal(device === null, false);
    assert.equal(Object.hasOwn(device!.following, "proxy"), false);
    assert.equal(Object.hasOwn(device!.overrides, "proxy"), false);
    assert.equal(database.outbox.ready(10_000).some(entry => entry.key === "state:preference:proxy"), false);
    const reopened = new PreferencesRepository(database.state, database.meta, { now: () => 200 });
    assert.equal(reopened.snapshot().following.proxy, false);
    assert.deepEqual(proxyRaw(database), raw);
  } finally { database.close(); }
});

test("snapshot reports proxy following only for a literal true flag", () => {
  const { database, preferences } = open();
  try {
    assert.equal(preferences.snapshot().following.proxy, false, "absent flag");
    const cases: [unknown, boolean][] = [[true, true], [false, false], ["true", false], [1, false], [null, false], [{}, false]];
    for (const [stored, expected] of cases) {
      database.meta.put("proxyFollowing", stored);
      assert.equal(preferences.snapshot().following.proxy, expected, JSON.stringify(stored));
    }
    assert.equal(database.outbox.count(), 0);
  } finally { database.close(); }
});

test("schema one proxy preference fixture round trips without entering values or the outbox", () => {
  const { database, preferences } = open();
  try {
    const fixture = JSON.parse(readSource("test/fixtures/schema1-state-preferences-proxy.json")) as { body: StateFragment };
    assert.equal(fixture.body.schema, 1);
    const setting = fixture.body.settings["polyask.preference.proxy"] as VersionedSyncValue;
    assert.equal(isVersionedPreference("proxy", setting), true);
    assert.equal(applyPreferences(database.state, fixture.body.settings), true);
    assert.deepEqual(projectPreferences(database.state), fixture.body.settings);
    assert.deepEqual(database.state.get("preference:proxy"), setting);
    const snapshot = preferences.snapshot();
    assert.equal(Object.hasOwn(snapshot.values, "proxy"), false);
    assert.equal(snapshot.initialized.includes("proxy"), false);
    assert.equal(Object.hasOwn(snapshot.versions, "proxy"), false);
    assert.equal(snapshot.following.proxy, false);
    assert.equal(database.outbox.count(), 0);
    assert.equal(applyPreferences(database.state, fixture.body.settings), false);
    // 更新但非规范的远端值（大写主机）进不了 state，也进不了投影。
    const bad = { ...setting, value: { ...(setting.value as ProxyPreference), host: "PROXY.EXAMPLE.COM" }, updatedAt: setting.updatedAt + 1 };
    assert.equal(applyPreferences(database.state, { "polyask.preference.proxy": bad }), false);
    assert.deepEqual(database.state.get("preference:proxy"), setting);
    assert.deepEqual(projectPreferences(database.state), fixture.body.settings);
  } finally { database.close(); }
});

test("local reset clears every proxy store while keeping the device identity", () => {
  const { database } = open();
  try {
    database.state.put("preference:proxy", { value: CUSTOM, updatedAt: 50, deviceId: "device-a" }, 50, true);
    database.meta.put("proxyOverride", CUSTOM);
    database.meta.put("proxyFollowing", true);
    database.meta.put("proxyAccepted", CUSTOM);
    database.resetLocalData();
    assert.deepEqual(proxyRaw(database), { shared: null, override: null, following: null, accepted: null });
    assert.equal(database.outbox.count(), 0);
    assert.equal(database.meta.get("deviceId"), "device-a");
  } finally { database.close(); }
});

test("only the proxy preference store may write proxy storage inside the main process", () => {
  const directory = path.join(__dirname, "..", "src", "main");
  const writers = [
    /\.(?:set|setFollowing|follow)\(\s*['"`]proxy['"`]/,
    /\.put\(\s*['"`]preference:proxy['"`]/,
    /\.put\(\s*`\$\{PREFERENCE_STATE_PREFIX\}proxy`/,
    /meta\.put\(\s*['"`]proxy(?:Override|Following|Accepted)['"`]/
  ];
  const offenders = readdirSync(directory)
    .filter(name => name.endsWith(".ts") && name !== "proxy-preference-store.ts")
    .filter(name => { const source = readSource(`src/main/${name}`); return writers.some(pattern => pattern.test(source)); });
  assert.deepEqual(offenders, []);
  const repository = readSource("src/main/preferences-repository.ts");
  assert.equal(/meta\.(?:put|delete)\([^)]*PROXY_FOLLOWING_KEY/.test(repository), false, "repository only reads proxyFollowing");
});
