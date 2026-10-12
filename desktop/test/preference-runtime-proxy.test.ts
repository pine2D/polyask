import assert from "node:assert/strict";
import test from "node:test";

import { DesktopDatabase } from "../src/main/database";
import { DraftRepository } from "../src/main/draft-repository";
import { PreferenceRuntime } from "../src/main/preference-runtime";
import { PreferencesRepository } from "../src/main/preferences-repository";
import type { ViewManager } from "../src/main/view-manager";
import type { SiteZoomPreferences } from "../src/shared/site-zoom";

function runtimeWith(proxy?: () => void) {
  const database = DesktopDatabase.open(":memory:");
  database.meta.put("deviceId", "device-a");
  let zoom: SiteZoomPreferences = {};
  const manager = { getUiState: () => ({ maximized: false, layoutMode: "overview", currentPage: 0, focusedByPage: {}, siteZoom: zoom }),
    getLayout: () => ({ focused: "kimi" }), setLayout: () => true,
    siteZoom: { restore: (next: SiteZoomPreferences) => { zoom = next; } } } as unknown as ViewManager;
  const order: string[] = [];
  const runtime = new PreferenceRuntime(new PreferencesRepository(database.state, database.meta, { now: () => 100 }),
    new DraftRepository(database.state, database.meta), manager, () => order.push("publish"), () => {}, () => {}, proxy);
  return { database, runtime, order };
}

test("only sync pull, backup restore and local reset mark the proxy dirty, never with a snapshot", () => {
  const argCounts: number[] = [];
  const { database, runtime } = runtimeWith((...args: unknown[]) => { argCounts.push(args.length); });
  try {
    assert.deepEqual(argCounts, [], "construction does not re-request: startup already applied the proxy before any view");
    runtime.set("completionNotifications", true);
    runtime.follow("display", true);
    runtime.setDisplay({ density: "compact", siteScale: 0.9 });
    runtime.setDraftSync(true);
    runtime.seed({ layoutMode: "overview" });
    assert.deepEqual(argCounts, [], "ordinary preference writes never hold the OperationGate for a proxy recompute");
    runtime.refresh();                          // sync pull / backup restore
    database.resetLocalData(); runtime.reset(); // local reset
    assert.deepEqual(argCounts, [0, 0], "one request per external refresh, and the callback never carries preference values");
  } finally { database.close(); }
});

test("the proxy is requested after the renderer snapshot is published", () => {
  const holder: { order?: string[] } = {};
  const { database, runtime, order } = runtimeWith(() => { holder.order?.push("proxy"); });
  holder.order = order;
  try {
    order.length = 0;
    runtime.refresh();
    assert.deepEqual(order, ["publish", "proxy"]);
  } finally { database.close(); }
});

test("a runtime built without a proxy callback still refreshes", () => {
  const { database, runtime, order } = runtimeWith();
  try {
    order.length = 0;
    runtime.refresh();
    assert.deepEqual(order, ["publish"]);
  } finally { database.close(); }
});
