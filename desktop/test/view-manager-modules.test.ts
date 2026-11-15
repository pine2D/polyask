import assert from "node:assert/strict";
import test from "node:test";

import { GenerationWatcher } from "../src/main/generation-watcher";
import { SiteStatusRegistry } from "../src/main/site-status-registry";
import { SiteViewTree } from "../src/main/site-view-tree";
import { SiteWorkspaceState } from "../src/main/site-workspace-state";
import type { SiteStatus } from "../src/shared/protocol";

test("SiteWorkspaceState restores per-page focus and computes background cover placements", () => {
  const workspace = new SiteWorkspaceState({
    selectedSites: ["claude", "chatgpt", "gemini", "deepseek", "doubao"],
    initialUiState: {
      windowBounds: { x: 0, y: 0, width: 1600, height: 1000 },
      maximized: false,
      layoutMode: "overview",
      currentPage: 1,
      focusedByPage: { 0: "chatgpt", 1: "doubao" },
      siteZoom: {}
    }
  });
  assert.equal(workspace.page, 1);
  assert.equal(workspace.focused, "doubao");

  assert.equal(workspace.computeViewportPlacements([0, 0], 1, false, false), null, "0x0 minimize resize keeps live state");
  const computed = workspace.computeViewportPlacements([1600, 1000], 1, false, false);
  assert.equal(computed !== null, true);
  assert.deepEqual(
    computed!.currentPlacements.map((item) => item.key),
    ["deepseek", "doubao"]
  );
  assert.equal(computed!.placementsWithBackground.length, 5, "all selected sites receive non-zero cover bounds");

  workspace.surface = "confirmation";
  assert.equal(workspace.setPage(0), false, "confirmation surface blocks page jumps");
  assert.equal(workspace.relativeFocusTarget(1), null);
});

test("SiteStatusRegistry tracks unread badges, proxy auth failures, and surface-gated clearing", () => {
  const published: SiteStatus[] = [];
  let visible = false;
  let authFailed = false;
  const registry = new SiteStatusRegistry(
    (site) => site === "claude" && visible,
    (status) => published.push(status),
    () => authFailed
  );

  registry.markRun({ site: "claude", phase: "complete" });
  assert.equal(registry.current("claude").unread, true);

  registry.clearVisibleUnread("settings", ["claude"]);
  assert.equal(registry.current("claude").unread, true, "non-sites surface never clears unread");

  visible = true;
  registry.clearVisibleUnread("sites", ["claude"]);
  assert.equal(registry.current("claude").unread, false);

  authFailed = true;
  // -130 = ERR_PROXY_CONNECTION_FAILED → proxy_failed, upgraded to proxy_auth_failed when auth fuse tripped
  assert.equal(registry.loadFailureCode(-130), "proxy_auth_failed");
  registry.updatePage({ site: "chatgpt", phase: "failed", code: registry.loadFailureCode(-130) });
  assert.equal(registry.pageFailureCode("chatgpt"), "proxy_auth_failed");

  registry.abandonNavigation("chatgpt", "failed");
  assert.equal(registry.pageFailureCode("chatgpt"), "load_failed");
});

test("GenerationWatcher extends deadline on first generating signal and settles after 3 complete probes", async () => {
  const statuses = new Map<string, SiteStatus>([["claude", { site: "claude", phase: "submitted" }]]);
  let probeReply: "generating" | "complete" | null = "generating";
  const completed: Array<{ runId: string; site: string }> = [];
  const watcher = new GenerationWatcher({
    getView: () => ({
      webContents: {
        isDestroyed: () => false,
        getURL: () => "https://claude.ai/chat/123"
      }
    } as never),
    commands: {
      send: async () => ({ state: probeReply }) as never
    },
    currentStatus: (site) => statuses.get(site) ?? { site, phase: "loading" },
    markStatus: (status) => { statuses.set(status.site, status); }
  });
  watcher.setOnComplete((runId, site) => completed.push({ runId, site }));

  try {
    watcher.beginRun("run-1", ["claude"]);
    const start = Date.now();
    watcher.watch("run-1", "claude");
    await new Promise((resolve) => setTimeout(resolve, 10));

    assert.equal(statuses.get("claude")?.phase, "generating");
    assert.equal((watcher.deadlines.get("claude") ?? 0) > start + 60_000, true, "generating extends deadline to 15 min");

    watcher.clearTracking("claude");
    probeReply = "complete";
    await watcher.probe("run-1", "claude");
    await watcher.probe("run-1", "claude");
    assert.equal(statuses.get("claude")?.phase, "generating", "debounced before 3 confirmations");
    await watcher.probe("run-1", "claude");
    assert.equal(statuses.get("claude")?.phase, "complete");
    assert.deepEqual(completed, [{ runId: "run-1", site: "claude" }]);
  } finally {
    watcher.cancel();
  }
});

test("SiteViewTree reorders attached views via addChildView without detaching and cleans up on dispose", () => {
  const events: string[] = [];
  let nextId = 1;
  const workspace = new SiteWorkspaceState({ selectedSites: ["claude", "chatgpt"] });
  const statuses = new SiteStatusRegistry(() => true, () => undefined);
  const tree = new SiteViewTree({
    window: {
      isDestroyed: () => false,
      isMinimized: () => false,
      getContentSize: () => [1600, 1000],
      webContents: { getZoomFactor: () => 1 },
      contentView: {
        addChildView: (view: { siteKey: string }) => events.push(`add:${view.siteKey}`),
        removeChildView: (view: { siteKey: string }) => events.push(`remove:${view.siteKey}`)
      }
    } as never,
    siteSession: {
      setPermissionCheckHandler() {},
      setPermissionRequestHandler() {}
    } as never,
    workspace,
    statuses,
    siteZoom: { bind() {}, apply() {}, forSite: () => 1 } as never,
    siteFind: { state: { open: false }, sync() {} } as never,
    getHistoryAccess: () => ({ panelOpen: false, initialLoad() {} }) as never,
    createSiteView: ((site: { key: string }) => {
      const id = nextId++;
      return {
        siteKey: site.key,
        setBounds() {},
        setVisible() {},
        webContents: {
          id,
          on() {},
          isDestroyed: () => false,
          close: () => events.push(`close:${site.key}`),
          focus: () => events.push(`focus:${site.key}`)
        }
      };
    }) as never,
    diagnosticSitesForViews: (() => []) as never,
    releaseUnselectedViews() {},
    setLayout: () => true,
    onLayout() {},
    onRuntimeEvent() {},
    getUiState: () => ({
      windowBounds: { x: 0, y: 0, width: 1600, height: 1000 },
      maximized: false,
      layoutMode: "overview",
      currentPage: 0,
      focusedByPage: {},
      siteZoom: {}
    }),
    webrtcPolicy: () => "default"
  });

  tree.initialize();
  assert.equal(tree.views.size, 2);
  assert.equal(events.some((entry) => entry.startsWith("remove:")), false, "reconcile/layout never detaches before reattaching");
  assert.equal(tree.owns({ id: 2 } as never), "chatgpt");

  tree.detachAll();
  assert.equal(tree.attached.size, 0);
  assert.deepEqual(events.filter((entry) => entry.startsWith("remove:")), ["remove:claude", "remove:chatgpt"]);

  tree.dispose();
  assert.equal(tree.views.size, 0);
  assert.deepEqual(events.filter((entry) => entry.startsWith("close:")), ["close:claude", "close:chatgpt"]);
});
