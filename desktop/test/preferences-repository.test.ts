import assert from "node:assert/strict";
import test from "node:test";

import { DesktopDatabase } from "../src/main/database";
import type { PreferenceKey } from "../src/shared/preferences";
import type { StateFragment, VersionedSyncValue } from "../src/shared/sync";
import { readSource } from "./fixtures";

async function openPreferences(deviceId = "device-a", now = 100) {
  const { PreferencesRepository } = await import("../src/main/preferences-repository");
  const database = DesktopDatabase.open(":memory:");
  database.meta.put("deviceId", deviceId);
  const preferences = new PreferencesRepository(database.state, database.meta, { now: () => now });
  return { database, preferences };
}

function setting(value: unknown, updatedAt = 200, deviceId = "device-b"): VersionedSyncValue {
  return { value, updatedAt, deviceId };
}

test("uninitialized preferences use device defaults without generating sync writes", async () => {
  const { database, preferences } = await openPreferences();
  try {
    const snapshot = preferences.snapshot();
    assert.deepEqual(snapshot.values, {
      completionNotifications: false, display: { density: "compact", siteScale: 0.9 },
      layoutMode: "overview", siteZoom: {}, workbenchGuide: null
    });
    assert.deepEqual(snapshot.following, { display: false, layout: false, siteZoom: false });
    assert.deepEqual(snapshot.initialized, []);
    assert.equal(snapshot.deviceId, "device-a");
    assert.equal(snapshot.draftSync, false);
    assert.equal(database.outbox.count(), 0);
    database.meta.put("draftSyncEnabled", "true");
    assert.equal(preferences.snapshot().draftSync, false);
    database.meta.put("draftSyncEnabled", true);
    assert.equal(preferences.snapshot().draftSync, true);
  } finally { database.close(); }
});

test("local display layout and site zoom edits preserve unrelated settings and stay off outbox", async () => {
  const { database, preferences } = await openPreferences();
  try {
    preferences.set("density", "comfortable");
    preferences.set("siteScale", 1);
    preferences.set("layoutMode", "focus");
    preferences.set("siteZoom.kimi", 1.25);
    preferences.set("siteZoom.claude", 0.75);
    preferences.set("density", "compact");
    assert.deepEqual(preferences.snapshot().values, {
      completionNotifications: false, display: { density: "compact", siteScale: 1 },
      layoutMode: "focus", siteZoom: { claude: 0.75, kimi: 1.25 }, workbenchGuide: null
    });
    assert.equal(database.outbox.count(), 0);
    assert.equal(database.state.entries("preference:").length, 0);
    assert.equal(database.meta.get("devicePreferences") !== null, true);
  } finally { database.close(); }
});

test("notification and guide edits always share with independent monotonic revisions", async () => {
  const { database, preferences } = await openPreferences();
  try {
    preferences.set("completionNotifications", true);
    preferences.set("workbenchGuide", { version: 1, disposition: "dismissed" });
    preferences.set("completionNotifications", false);
    preferences.set("completionNotifications", true);
    assert.deepEqual(database.state.get("preference:completionNotifications"), setting(true, 102, "device-a"));
    assert.deepEqual(database.state.get("preference:workbenchGuide"), setting({ version: 1, disposition: "dismissed" }, 100, "device-a"));
    assert.deepEqual(database.outbox.ready(1_000).map(entry => entry.key).sort(), [
      "state:preference:completionNotifications", "state:preference:workbenchGuide"
    ]);
    assert.equal(preferences.snapshot().versions.completionNotifications?.updatedAt, 102);
  } finally { database.close(); }
});

test("seed only fills missing keys and does not overwrite local or remote preferences", async () => {
  const { database, preferences } = await openPreferences();
  try {
    preferences.set("density", "comfortable");
    database.state.put("preference:completionNotifications", setting(true), 200, false);
    database.state.put("preference:layoutMode", setting("focus"), 200, false);
    preferences.seed({ completionNotifications: false, display: { density: "compact", siteScale: 1 },
      layoutMode: "overview", siteZoom: { kimi: 1.1 }, workbenchGuide: null });
    preferences.seed({ completionNotifications: false, display: { density: "compact", siteScale: 0.9 },
      siteZoom: { kimi: 2 }, workbenchGuide: { version: 1, disposition: "completed" } });
    assert.equal(preferences.snapshot().values.completionNotifications, true);
    assert.deepEqual(preferences.snapshot().values.display, { density: "comfortable", siteScale: 1 });
    assert.equal(preferences.snapshot().values.workbenchGuide, null);
    assert.deepEqual(preferences.snapshot().values.siteZoom, { kimi: 1.1 });
    assert.deepEqual(database.state.get("preference:layoutMode"), setting("focus"));
    assert.equal(database.outbox.count(), 1);
    assert.equal(preferences.snapshot().initialized.includes("workbenchGuide"), true);
    preferences.setFollowing("layout", true);
    assert.equal(preferences.snapshot().values.layoutMode, "focus");
  } finally { database.close(); }
});

test("following uses cloud values and disabling captures them for this device", async () => {
  const { database, preferences } = await openPreferences();
  try {
    const { applyPreferences } = await import("../src/main/sync-preferences");
    preferences.set("density", "compact");
    preferences.set("siteScale", 0.9);
    applyPreferences(database.state, {
      "polyask.preference.density": setting("comfortable"),
      "polyask.preference.siteScale": setting(1)
    });
    assert.deepEqual(preferences.snapshot().values.display, { density: "compact", siteScale: 0.9 });
    preferences.setFollowing("display", true);
    assert.deepEqual(preferences.snapshot().values.display, { density: "comfortable", siteScale: 1 });
    preferences.setFollowing("display", false);
    applyPreferences(database.state, { "polyask.preference.density": setting("compact", 300) });
    assert.deepEqual(preferences.snapshot().values.display, { density: "comfortable", siteScale: 1 });
    assert.equal(database.outbox.count(), 0);
  } finally { database.close(); }
});

test("late legacy seed preserves device display when shared values arrived before migration", async () => {
  const { database, preferences } = await openPreferences();
  try {
    database.state.put("preference:density", setting("compact"), 200, false);
    database.state.put("preference:siteScale", setting(0.9), 200, false);
    preferences.seed({ display: { density: "comfortable", siteScale: 1 } });
    assert.deepEqual(preferences.snapshot().values.display, { density: "comfortable", siteScale: 1 });
    assert.deepEqual(database.state.get("preference:density"), setting("compact"));
    assert.equal(database.outbox.count(), 0);
    preferences.setFollowing("display", true);
    preferences.seed({ display: { density: "comfortable", siteScale: 1 } });
    assert.deepEqual(preferences.snapshot().values.display, { density: "compact", siteScale: 0.9 });
  } finally { database.close(); }
});

test("enabling following initializes only missing shared values from effective device defaults", async () => {
  const { database, preferences } = await openPreferences();
  try {
    preferences.set("density", "comfortable");
    preferences.set("siteZoom.kimi", 1.25);
    preferences.setFollowing("display", true);
    preferences.setFollowing("siteZoom", true);
    assert.deepEqual(database.state.get("preference:density"), setting("comfortable", 100, "device-a"));
    assert.deepEqual(database.state.get("preference:siteScale"), setting(0.9, 100, "device-a"));
    assert.deepEqual(database.state.get("preference:siteZoom.kimi"), setting(1.25, 100, "device-a"));
    assert.equal(database.state.get("preference:siteZoom.claude"), null);
    assert.equal(database.outbox.count(), 3);
    preferences.setFollowing("siteZoom", true);
    assert.equal(database.outbox.count(), 3);
  } finally { database.close(); }
});

test("edits while following revise only the edited shared field", async () => {
  const { database, preferences } = await openPreferences();
  try {
    preferences.setFollowing("display", true);
    preferences.set("density", "comfortable");
    assert.deepEqual(database.state.get("preference:siteScale"), setting(0.9, 100, "device-a"));
    assert.deepEqual(database.state.get("preference:density"), setting("comfortable", 101, "device-a"));
    preferences.setFollowing("siteZoom", true);
    preferences.set("siteZoom.kimi", 1.5);
    preferences.set("siteZoom.claude", 0.8);
    preferences.set("siteZoom.kimi", 1);
    assert.deepEqual(preferences.snapshot().values.siteZoom, { claude: 0.8, kimi: 1 });
    assert.deepEqual(database.state.get("preference:siteZoom.claude"), setting(0.8, 100, "device-a"));
  } finally { database.close(); }
});

test("independent field conflicts converge without discarding another site's zoom", async () => {
  const first = await openPreferences("device-a", 100);
  const second = await openPreferences("device-z", 100);
  try {
    const { projectPreferences, applyPreferences } = await import("../src/main/sync-preferences");
    first.preferences.setFollowing("siteZoom", true);
    second.preferences.setFollowing("siteZoom", true);
    first.preferences.set("siteZoom.kimi", 1.25);
    first.preferences.set("siteZoom.claude", 0.75);
    second.preferences.set("siteZoom.kimi", 1.5);
    second.preferences.set("siteZoom.gemini", 1.1);
    const a = projectPreferences(first.database.state), b = projectPreferences(second.database.state);
    assert.equal(applyPreferences(first.database.state, b), true);
    assert.equal(applyPreferences(second.database.state, a), true);
    assert.deepEqual(first.preferences.snapshot().values.siteZoom, { claude: 0.75, gemini: 1.1, kimi: 1.5 });
    assert.deepEqual(second.preferences.snapshot().values.siteZoom, { claude: 0.75, gemini: 1.1, kimi: 1.5 });
    assert.equal(applyPreferences(first.database.state, b), false);
    assert.equal(second.database.outbox.count(), 2);
  } finally { first.database.close(); second.database.close(); }
});

test("schema one preference fixture round trips and shared imports do not enqueue uploads", async () => {
  const { database, preferences } = await openPreferences();
  try {
    const { projectPreferences, applyPreferences } = await import("../src/main/sync-preferences");
    const fixture = JSON.parse(readSource("test/fixtures/schema1-state-preferences.json")) as { body: StateFragment };
    assert.equal(fixture.body.schema, 1);
    assert.equal(applyPreferences(database.state, fixture.body.settings), true);
    assert.deepEqual(projectPreferences(database.state), fixture.body.settings);
    assert.equal(preferences.snapshot().values.completionNotifications, true);
    assert.deepEqual(preferences.snapshot().values.workbenchGuide, { version: 1, disposition: "completed" });
    assert.equal(database.outbox.count(), 0);
    assert.equal(applyPreferences(database.state, fixture.body.settings), false);
  } finally { database.close(); }
});

test("invalid local edits and unknown groups reject before mutating valid preferences", async () => {
  const { database, preferences } = await openPreferences();
  try {
    preferences.set("siteZoom.kimi", 1.25);
    const before = JSON.stringify(preferences.snapshot());
    const invalid: [string, unknown][] = [
      ["completionNotifications", 1], ["density", "dense"], ["siteScale", 0.8], ["layoutMode", "grid"],
      ["siteZoom.unknown", 1], ["siteZoom.kimi", 0.24], ["siteZoom.kimi", 5.01],
      ["siteZoom.kimi", NaN], ["siteZoom.kimi", Infinity], ["siteZoom.kimi", "1"],
      ["siteZoom", {}], ["workbenchGuide", { version: 2, disposition: "completed" }],
      ["workbenchGuide", { version: 1, disposition: "pending" }]
    ];
    for (const [key, value] of invalid) assert.throws(() => preferences.set(key as PreferenceKey, value), /invalid_preference/);
    assert.throws(() => preferences.setFollowing("unknown" as "display", true), /invalid_preference/);
    assert.throws(() => preferences.setFollowing("display", "true" as unknown as boolean), /invalid_preference/);
    assert.equal(JSON.stringify(preferences.snapshot()), before);
    assert.equal(database.outbox.count(), 0);
  } finally { database.close(); }
});

test("bad newer remote values cannot overwrite valid preferences or enter projection", async () => {
  const { database, preferences } = await openPreferences();
  try {
    const { projectPreferences, applyPreferences } = await import("../src/main/sync-preferences");
    preferences.set("completionNotifications", true);
    const invalid: unknown[] = [setting("true", 500), setting(false, -1), setting(false, 1.5),
      setting(false, 500, ""), { value: false, updatedAt: 500, deviceId: "b", deletedAt: 500 },
      { updatedAt: 500, deviceId: "b" }, null, []];
    for (const value of invalid) {
      assert.equal(applyPreferences(database.state, { "polyask.preference.completionNotifications": value as VersionedSyncValue }), false);
    }
    assert.equal(applyPreferences(database.state, {
      "polyask.preference.siteZoom.future": setting(1), "polyask.preference.future": setting(true),
      "polyask.preference.siteZoom.kimi": setting(6), "polyask.preference.workbenchGuide": setting({ version: 1, disposition: "pending" })
    }), false);
    assert.equal(preferences.snapshot().values.completionNotifications, true);
    database.state.put("preference:density", setting("bad"), 200, false);
    database.state.put("preference:future", setting(true), 200, false);
    assert.deepEqual(Object.keys(projectPreferences(database.state)), ["polyask.preference.completionNotifications"]);
  } finally { database.close(); }
});

test("local metadata corruption falls back without contaminating shared settings", async () => {
  const { database, preferences } = await openPreferences();
  try {
    database.meta.put("devicePreferences", { following: { display: "true", layout: true, siteZoom: false },
      overrides: { density: "broken", siteScale: 5, "siteZoom.kimi": 9, layoutMode: "focus" } });
    const snapshot = preferences.snapshot({ display: { density: "comfortable", siteScale: 1 } });
    assert.deepEqual(snapshot.following, { display: false, layout: true, siteZoom: false });
    assert.deepEqual(snapshot.values.display, { density: "comfortable", siteScale: 1 });
    assert.deepEqual(snapshot.values.siteZoom, {});
    assert.equal(database.outbox.count(), 0);
  } finally { database.close(); }
});

test("reset clears shared and device preference state while retaining device identity", async () => {
  const { database, preferences } = await openPreferences();
  try {
    preferences.seed({ completionNotifications: true, workbenchGuide: { version: 1, disposition: "completed" },
      display: { density: "comfortable", siteScale: 1 }, siteZoom: { kimi: 2 } });
    preferences.setFollowing("display", true);
    database.meta.put("draftSyncEnabled", true);
    database.resetLocalData();
    const snapshot = preferences.snapshot();
    assert.deepEqual(snapshot.initialized, []);
    assert.deepEqual(snapshot.following, { display: false, layout: false, siteZoom: false });
    assert.equal(snapshot.values.completionNotifications, false);
    assert.equal(snapshot.values.workbenchGuide, null);
    assert.equal(snapshot.deviceId, "device-a");
    assert.equal(snapshot.draftSync, false);
    assert.equal(database.outbox.count(), 0);
  } finally { database.close(); }
});

test("shared legacy seeds yield to an older cloud choice that arrives after migration", async () => {
  const { database, preferences } = await openPreferences("new-device", 1_000);
  const { SyncRepository } = await import("../src/main/sync-repository");
  try {
    preferences.seed({ completionNotifications: false, workbenchGuide: { version: 1, disposition: "dismissed" },
      display: { density: "comfortable", siteScale: 1 } });
    new SyncRepository(database).applyStateFragments({ cloud: {
      schema: 1, deviceId: "old-device", templates: {}, groups: {}, settings: {
        "polyask.preference.completionNotifications": setting(true, 100, "old-device"),
        "polyask.preference.workbenchGuide": setting({ version: 1, disposition: "completed" }, 101, "old-device"),
        "polyask.preference.density": setting("compact", 102, "old-device")
      }
    } });
    assert.equal(preferences.snapshot().values.completionNotifications, true);
    assert.deepEqual(preferences.snapshot().values.workbenchGuide, { version: 1, disposition: "completed" });
    assert.deepEqual(preferences.snapshot().values.display, { density: "comfortable", siteScale: 1 });
  } finally { database.close(); }
});

test("an explicit shared choice promotes an unchanged legacy value to a normal revision", async () => {
  const { database, preferences } = await openPreferences("new-device", 1_000);
  const { SyncRepository } = await import("../src/main/sync-repository");
  try {
    preferences.seed({ completionNotifications: false, workbenchGuide: { version: 1, disposition: "dismissed" } });
    assert.equal(preferences.snapshot().versions.completionNotifications?.updatedAt, 0);
    assert.equal(preferences.snapshot().versions.workbenchGuide?.updatedAt, 0);
    preferences.set("completionNotifications", false);
    preferences.set("workbenchGuide", { version: 1, disposition: "dismissed" });
    assert.equal(preferences.snapshot().versions.completionNotifications?.updatedAt, 1_000);
    assert.equal(preferences.snapshot().versions.workbenchGuide?.updatedAt, 1_000);
    new SyncRepository(database).applyStateFragments({ cloud: {
      schema: 1, deviceId: "old-device", templates: {}, groups: {}, settings: {
        "polyask.preference.completionNotifications": setting(true, 100, "old-device"),
        "polyask.preference.workbenchGuide": setting({ version: 1, disposition: "completed" }, 101, "old-device")
      }
    } });
    assert.equal(preferences.snapshot().values.completionNotifications, false);
    assert.deepEqual(preferences.snapshot().values.workbenchGuide, { version: 1, disposition: "dismissed" });
  } finally { database.close(); }
});
