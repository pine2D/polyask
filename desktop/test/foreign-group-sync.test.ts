import assert from "node:assert/strict";
import test from "node:test";

import { DesktopDatabase } from "../src/main/database";
import { SyncRepository } from "../src/main/sync-repository";
import { WorkspaceService } from "../src/main/workspace-service";
import type { StateFragment } from "../src/shared/sync";
import type { WorkspaceGroup } from "../src/shared/workspace";

const cloudGroup = { id: "mixed", name: "Mixed", hosts: ["claude.ai", "chatgpt.com", "brand-new.example"], updatedAt: 5_000, deviceId: "new-client" };
const remote = (): Record<string, StateFragment> => ({
  "state-new": { schema: 1, deviceId: "new-client", settings: {}, templates: {}, groups: { mixed: { ...cloudGroup, hosts: [...cloudGroup.hosts] } } }
} as unknown as Record<string, StateFragment>);

function device() {
  const database = DesktopDatabase.open(":memory:");
  database.meta.put("deviceId", "old-desktop");
  return { database, repository: new SyncRepository(database), workspace: new WorkspaceService(database.state, database.meta, () => undefined, { now: () => 9_000 }) };
}

test("an untouched group naming unknown hosts is republished exactly as the cloud copy", () => {
  const d = device();
  try {
    d.repository.applyStateFragments(remote());
    assert.deepEqual(d.repository.localStateFragment().groups.mixed, cloudGroup,
      "same version must mean same content, or the tie between copies becomes order dependent");
  } finally { d.database.close(); }
});

test("a local edit of a group with unknown hosts survives the next pull and keeps those hosts", () => {
  const d = device();
  try {
    d.repository.applyStateFragments(remote());
    const sites = (d.database.state.get<WorkspaceGroup>("group:mixed") as unknown as { sites: string[] }).sites;
    d.workspace.saveGroup({ id: "mixed", name: "Renamed locally", sites: sites.filter((site) => site !== "chatgpt") as never });
    const uploaded = d.repository.localStateFragment().groups.mixed as typeof cloudGroup;
    assert.equal(uploaded.name, "Renamed locally");
    assert.equal(uploaded.updatedAt, 9_000);
    assert.deepEqual([...uploaded.hosts].sort(), ["brand-new.example", "claude.ai"], "edits replace known hosts and keep unknown ones");

    d.repository.applyStateFragments(remote()); // next incremental pull, cloud unchanged
    const after = d.database.state.get<WorkspaceGroup>("group:mixed") as unknown as { name: string; sites: string[] };
    assert.equal(after.name, "Renamed locally", "the local edit must not be rolled back by the older cloud copy");
    assert.deepEqual(after.sites, ["claude"]);
  } finally { d.database.close(); }
});
