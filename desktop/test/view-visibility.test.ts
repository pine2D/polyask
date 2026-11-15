import assert from "node:assert/strict";
import test from "node:test";

import { reconcileVisibleSiteKeys } from "../src/main/view-visibility";
import { readSource } from "./fixtures";

test("view reconciliation detaches inactive pages and attaches only newly visible sites", () => {
  assert.deepEqual(
    reconcileVisibleSiteKeys(
      ["claude", "chatgpt", "gemini", "doubao", "deepseek", "qianwen"],
      ["kimi", "yuanbao", "chatglm"]
    ),
    {
      attach: ["kimi", "yuanbao", "chatglm"],
      detach: ["claude", "chatgpt", "gemini", "doubao", "deepseek", "qianwen"]
    }
  );
  assert.deepEqual(
    reconcileVisibleSiteKeys(["claude", "chatgpt"], ["chatgpt", "gemini"]),
    { attach: ["gemini"], detach: ["claude"] }
  );
});

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
