import assert from "node:assert/strict";
import test from "node:test";

import { readSource } from "./fixtures";

test("commands is a supported shell surface", () => {
  const protocol = readSource("src/shared/protocol.ts");
  assert.match(protocol, /export type DesktopSurface =[^\n]*"commands"/);
});

test("unread badges are only cleared while the site surface is showing", () => {
  const manager = readSource("src/main/view-manager.ts");
  const registry = readSource("src/main/site-status-registry.ts");
  assert.match(manager, /this\.statuses\.clearVisibleUnread\(this\.workspace\.surface, this\.workspace\.visibleSites\(\)\)/);
  assert.match(registry, /if \(surface !== "sites"\) return;/);
});

test("restored focus prefers the site remembered for the restored page", () => {
  const manager = readSource("src/main/view-manager.ts");
  const workspace = readSource("src/main/site-workspace-state.ts");
  assert.match(manager, /new SiteWorkspaceState\(\{\s*selectedSites: options\.selectedSites,\s*initialUiState: options\.initialUiState\s*\}\)/);
  assert.match(
    workspace,
    /resolveFocusedSite\(\s*current\.keys,\s*this\.focusedByPage\.get\(current\.page\) \?\? this\.focused,\s*this\.focused\s*\)/
  );
});
