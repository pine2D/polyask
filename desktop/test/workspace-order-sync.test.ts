import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { DesktopDatabase } from "../src/main/database";
import { SyncRepository } from "../src/main/sync-repository";
import { WorkspaceService } from "../src/main/workspace-service";

function fixture(deviceId: string) {
  const database = DesktopDatabase.open(":memory:");
  database.meta.put("deviceId", deviceId);
  const workspace = new WorkspaceService(database.state, database.meta, () => {}, { now: () => 100 });
  return { database, workspace, sync: new SyncRepository(database) };
}

test("site and saved group order survive the real sync projection and a local reset", () => {
  const a = fixture("a"), b = fixture("b");
  try {
    a.workspace.setSelection(["kimi", "claude", "gemini"]);
    const group = a.workspace.saveGroup({ name: "Research", sites: ["kimi", "claude", "gemini"] });
    const body = JSON.parse(JSON.stringify(a.sync.localStateFragment()));
    assert.deepEqual(body.settings["amsConsole.siteOrder"]?.value, ["www.kimi.com", "claude.ai", "gemini.google.com"]);
    b.sync.applyStateFragments({ a: body });
    assert.deepEqual(b.workspace.getState().selectedSites, ["kimi", "claude", "gemini"]);
    assert.deepEqual(b.workspace.getState().groups.find(g => g.id === group.id)?.sites, ["kimi", "claude", "gemini"]);
    b.database.resetLocalData();
    assert.deepEqual(b.workspace.getState().selectedSites.slice(0, 3), ["claude", "chatgpt", "gemini"]);
    b.sync.applyStateFragments({ a: body });
    assert.deepEqual(b.workspace.getState().selectedSites, ["kimi", "claude", "gemini"]);
  } finally { a.database.close(); b.database.close(); }
});

test("frozen ordered state imports while legacy selection ignores stale or malformed order", () => {
  const f = fixture("local");
  const { body } = JSON.parse(readFileSync(join(__dirname, "fixtures/schema1-state-site-order.json"), "utf8"));
  try {
    f.sync.applyStateFragments({ remote: body });
    assert.deepEqual(f.workspace.getState().selectedSites, ["kimi", "claude", "gemini"]);
    const next = structuredClone(body);
    next.settings["amsConsole.selected"].updatedAt += 10;
    next.settings["amsConsole.selected"].value = { "claude.ai": true, "www.kimi.com": true };
    f.sync.applyStateFragments({ remote: next });
    assert.deepEqual(f.workspace.getState().selectedSites, ["claude", "kimi"]);
    next.settings["amsConsole.siteOrder"].updatedAt = next.settings["amsConsole.selected"].updatedAt;
    next.settings["amsConsole.siteOrder"].value = ["www.kimi.com", "future.example", "www.kimi.com"];
    f.sync.applyStateFragments({ remote: next });
    assert.deepEqual(f.workspace.getState().selectedSites, ["kimi", "claude"]);
    next.settings["amsConsole.siteOrder"].value = "bad";
    f.sync.applyStateFragments({ remote: next });
    assert.deepEqual(f.workspace.getState().selectedSites, ["claude", "kimi"]);
  } finally { f.database.close(); }
});

test("uploading a reordered selection retains unknown hosts from a newer client's order", () => {
  const f = fixture("local");
  const { body } = JSON.parse(readFileSync(join(__dirname, "fixtures/schema1-state-site-order.json"), "utf8"));
  body.settings["amsConsole.selected"].value["future.example"] = true;
  body.settings["amsConsole.siteOrder"].value.push("future.example");
  try {
    f.sync.applyStateFragments({ remote: body });
    f.workspace.setSelection(["claude", "kimi"]);
    const next = f.sync.localStateFragment();
    assert.deepEqual(next.settings["amsConsole.siteOrder"].value, ["claude.ai", "www.kimi.com", "future.example"]);
  } finally { f.database.close(); }
});

test("a no-op sync preserves unknown host positions rather than silently reordering a future client", () => {
  const f = fixture("z-local");
  const { body } = JSON.parse(readFileSync(join(__dirname, "fixtures/schema1-state-site-order.json"), "utf8"));
  body.settings["amsConsole.selected"].value["future.example"] = true;
  body.settings["amsConsole.siteOrder"].value = ["www.kimi.com", "future.example", "claude.ai", "gemini.google.com"];
  try {
    f.sync.applyStateFragments({ remote: body });
    assert.deepEqual(f.sync.localStateFragment().settings["amsConsole.siteOrder"].value,
      ["www.kimi.com", "future.example", "claude.ai", "gemini.google.com"]);
  } finally { f.database.close(); }
});
