import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { transformSync } from "esbuild";
import { readSource } from "./fixtures";
import { RELOAD_COMMIT_CAP_MS, ReloadCommitWatch } from "../src/main/reload-commit";
import { NEW_SESSION_COMMIT_CAP_MS } from "../src/main/workspace-service";
import { SiteHistoryAccess } from "../src/main/site-history-access";
import { SITES } from "../src/main/sites";

const EVENTS = ["did-navigate", "did-fail-load", "destroyed"];

function contents(id = 7) {
  let destroyed = false;
  const emitter = new EventEmitter();
  return Object.assign(emitter, { id, isDestroyed: () => destroyed, destroy() { destroyed = true; emitter.emit("destroyed"); } });
}

test("a reload that never commits is abandoned at the cap; a committed reload is left alone", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const abandoned: string[] = [];
  const watch = new ReloadCommitWatch((site, id) => abandoned.push(`${site}:${id}`), 1_000);
  const hung = contents(7);
  watch.replace("claude", hung);
  t.mock.timers.tick(999);
  assert.deepEqual(abandoned, []);
  t.mock.timers.tick(1);
  assert.deepEqual(abandoned, ["claude:7"], "the stuck document request is stopped and pinned instead of loading forever");
  assert.equal(watch.watching("claude"), false);
  for (const event of EVENTS) assert.equal(hung.listenerCount(event), 0, event);

  const fine = contents(8);
  watch.replace("gemini", fine);
  fine.emit("did-navigate", {}, "https://gemini.google.com/app", 200, "OK");
  t.mock.timers.tick(5_000);
  assert.deepEqual(abandoned, ["claude:7"]);
  for (const event of EVENTS) assert.equal(fine.listenerCount(event), 0, event);
});

test("only a real main-frame failure or a destroyed view ends the watch early", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const abandoned: string[] = [];
  const watch = new ReloadCommitWatch((site, id) => abandoned.push(`${site}:${id}`), 1_000);
  const page = contents();
  watch.replace("claude", page);
  page.emit("did-fail-load", {}, -105, "", "https://ads.example/", false);
  page.emit("did-fail-load", {}, -3, "", "https://claude.ai/new", true);
  assert.equal(watch.watching("claude"), true, "subframe failures and ERR_ABORTED are not this reload failing");
  page.emit("did-fail-load", {}, -105, "", "https://claude.ai/new", true);
  assert.equal(watch.watching("claude"), false, "PageLifecycle already pinned the failure");
  const gone = contents(9);
  watch.replace("claude", gone);
  gone.destroy();
  t.mock.timers.tick(2_000);
  assert.deepEqual(abandoned, []);
});

test("another navigation replaces the reload watch so the old timer cannot abort it", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const abandoned: string[] = [];
  const watch = new ReloadCommitWatch((site, id) => abandoned.push(`${site}:${id}`), 1_000);
  const first = contents(7);
  watch.replace("claude", first);
  t.mock.timers.tick(900);
  watch.replace("claude");
  for (const event of EVENTS) assert.equal(first.listenerCount(event), 0, event);
  t.mock.timers.tick(900);
  assert.deepEqual(abandoned, [], "a back/new-session navigation is never aborted by the reload timer");
  watch.replace("claude", first);
  t.mock.timers.tick(900);
  watch.replace("claude", first);
  t.mock.timers.tick(900);
  assert.deepEqual(abandoned, [], "reloading again restarts the cap");
  t.mock.timers.tick(100);
  assert.deepEqual(abandoned, ["claude:7"]);
});

test("the reload cap keeps at least 20% margin over every measured main-frame commit", () => {
  // Windows live runs: reload→did-navigate 104–1776ms (5 reloads), new-session navigations up to 3557ms.
  assert.ok(RELOAD_COMMIT_CAP_MS >= 1_776 * 1.2);
  assert.ok(RELOAD_COMMIT_CAP_MS >= 3_557 * 1.2);
  assert.ok(RELOAD_COMMIT_CAP_MS >= 13_000 * 1.2, "round 6: ChatGPT's cookie-bearing HTML took ~13s on a slow network");
  assert.ok(RELOAD_COMMIT_CAP_MS >= NEW_SESSION_COMMIT_CAP_MS, "a reload holds no gate, so it is never stricter than new session");
  assert.ok(RELOAD_COMMIT_CAP_MS <= 30_000, "the user must get a usable failure long before minutes of loading");
});

// The real ViewManager, run against stubbed Electron views (same approach as view-reclamation.test.ts).
function harness({ committed = true } = {}) {
  const require = createRequire(resolve(__dirname, "../src/main/view-manager.ts"));
  const views: any[] = [];
  let nextId = 1;
  const window = Object.assign(new EventEmitter(), {
    isDestroyed: () => false, isMinimized: () => false, getContentSize: () => [2560, 1378],
    getNormalBounds: () => ({ x: 0, y: 0, width: 2560, height: 1378 }), isMaximized: () => false,
    contentView: { addChildView() {}, removeChildView() {} },
    webContents: Object.assign(new EventEmitter(), { getZoomFactor: () => 1 })
  });
  const module = { exports: {} as any };
  runInNewContext(transformSync(readSource("src/main/view-manager.ts"), { loader: "ts", format: "cjs" }).code, {
    module, exports: module.exports, setTimeout, clearTimeout,
    require: (name: string) => {
      if (name === "electron") return { session: { fromPartition: () => ({ setPermissionCheckHandler() {}, setPermissionRequestHandler() {}, clearStorageData: async () => {} }) } };
      if (name === "./site-view") return { createSiteView: () => {
        const id = nextId++;
        const calls: string[] = [];
        let zoom = 1;
        const webContents = Object.assign(new EventEmitter(), { id, calls,
          isDestroyed: () => false, close() {}, loadURL: async () => {}, focus() {},
          getURL: () => "https://claude.ai/new",
          reload: () => calls.push("reload"), reloadIgnoringCache: () => calls.push("reloadIgnoringCache"),
          stop: () => calls.push("stop"), send: () => calls.push("send"),
          navigationHistory: { canGoBack: () => true, canGoForward: () => false, goBack: () => calls.push("goBack"), goForward() {} },
          setZoomMode() {}, getZoomFactor: () => zoom, setZoomFactor: (value: number) => { zoom = value; }
        });
        views.push(webContents);
        return { setVisible() {}, setBounds() {}, webContents };
      } };
      return require(name);
    }
  });
  const manager = new module.exports.ViewManager(window, () => {}, () => {}, undefined, { selectedSites: ["claude", "chatgpt"] });
  const status = (site: string) => manager.getStatuses().find((item: { site: string }) => item.site === site);
  // The views' first loads are under the commit cap too; most tests start from pages whose first load already committed.
  if (committed) for (const view of views) view.emit("did-navigate", {}, view.getURL(), 200, "OK");
  return { manager, window, views, status };
}

test("reloadSite never leaves a site loading forever when the document request hangs (Claude 11+ min on Windows)", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const h = harness();
  try {
    const claude = h.views[0];
    h.manager.markStatus({ site: "claude", phase: "ready" });
    for (const ignoreCache of [false, true]) {
      assert.equal(h.manager.reload("claude", ignoreCache), true);
      assert.equal(h.status("claude").phase, "loading");
      t.mock.timers.tick(RELOAD_COMMIT_CAP_MS - 1);
      assert.equal(h.status("claude").phase, "loading");
      t.mock.timers.tick(1);
      assert.equal(h.status("claude").phase, "failed");
      assert.equal(h.status("claude").code, "load_failed");
      assert.equal(claude.calls.at(-1), "stop", "the stuck navigation is stopped before the failure is pinned");
    }
    assert.deepEqual(claude.calls, ["reload", "stop", "reloadIgnoringCache", "stop"], "the user can reload again after the cap");

    // A reload that commits in time is never touched.
    assert.equal(h.manager.reload("claude"), true);
    claude.emit("did-navigate", {}, "https://claude.ai/new", 200, "OK");
    t.mock.timers.tick(RELOAD_COMMIT_CAP_MS * 2);
    assert.equal(h.status("claude").phase, "loading");
    assert.equal(claude.calls.filter((call: string) => call === "stop").length, 2);

    // Clearing site data reloads too, and gets the same cap.
    const chatgpt = h.views[1];
    h.manager.markStatus({ site: "chatgpt", phase: "ready" });
    assert.equal(await h.manager.clearSiteData("chatgpt"), true);
    t.mock.timers.tick(RELOAD_COMMIT_CAP_MS);
    assert.deepEqual(chatgpt.calls, ["reloadIgnoringCache", "stop"]);
    assert.equal(h.status("chatgpt").code, "load_failed");
  } finally { h.window.emit("closed"); }
});

test("a view's first load gets the same cap: a hung document request ends in load_failed instead of loading forever", (t) => {
  // Windows round 6 (2026-10-05): a re-created Claude view sat in loading for 12+ minutes with no reload affordance.
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const h = harness({ committed: false });
  try {
    const [claude, chatgpt] = h.views;
    assert.equal(h.status("claude").phase, "loading");
    chatgpt.emit("did-navigate", {}, "https://chatgpt.com/", 200, "OK");
    t.mock.timers.tick(RELOAD_COMMIT_CAP_MS - 1);
    assert.equal(h.status("claude").phase, "loading");
    t.mock.timers.tick(1);
    assert.deepEqual({ phase: h.status("claude").phase, code: h.status("claude").code }, { phase: "failed", code: "load_failed" });
    assert.deepEqual([...claude.calls], ["stop"]);
    assert.deepEqual([...chatgpt.calls], [], "a first load that committed in time is never touched");
    assert.equal(h.status("chatgpt").phase, "loading", "commit is not ready: did-finish-load still drives readiness");
    assert.equal(h.manager.reload("claude"), true, "the failure exposes the reload affordance");
  } finally { h.window.emit("closed"); }
});

test("a hung reload of the page already on screen keeps that document ready instead of pinning load_failed", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const h = harness();
  try {
    const claude = h.views[0];
    claude.mainFrame = { url: "https://claude.ai/new", origin: "https://claude.ai" };
    h.manager.markStatus({ site: "claude", phase: "ready" });
    assert.equal(h.manager.reload("claude"), true);
    assert.equal(h.status("claude").phase, "loading");
    t.mock.timers.tick(RELOAD_COMMIT_CAP_MS);
    assert.equal(claude.calls.at(-1), "stop", "the stuck reload is still stopped at the cap");
    assert.deepEqual({ phase: h.status("claude").phase, code: h.status("claude").code ?? null }, { phase: "ready", code: null });
    // A first load has no committed document to keep (see the first-load test above): still load_failed.
  } finally { h.window.emit("closed"); }
});

test("history restore and new session retire a pending reload watch before navigating", () => {
  const page = Object.assign(contents(4), { getURL: () => "https://claude.ai/chat/old", loadURL: () => new Promise<void>(() => {}) });
  const access = new SiteHistoryAccess(() => ({ webContents: page }) as never, {} as never, () => {});
  access.reloads.replace("claude", page);
  assert.equal(access.reloads.watching("claude"), true);
  void access.navigate("claude", "https://claude.ai/new", true);
  assert.equal(access.reloads.watching("claude"), false);
  assert.equal(page.listenerCount("did-navigate"), 1, "only the navigation's own commit listener remains");
});

test("a renderer crash during a pending reload ends the watch so the cap cannot rewrite the crash as load_failed", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const abandoned: string[] = [];
  const watch = new ReloadCommitWatch((site, id) => abandoned.push(`${site}:${id}`), 1_000);
  const page = contents(7);
  watch.replace("claude", page);
  page.emit("render-process-gone", {}, { reason: "oom", exitCode: -1 });
  assert.equal(watch.watching("claude"), false);
  t.mock.timers.tick(2_000);
  assert.deepEqual(abandoned, [], "renderer_crashed stays the reported cause");
  for (const event of [...EVENTS, "render-process-gone"]) assert.equal(page.listenerCount(event), 0, event);
});

// Results come from the vm realm the manager runs in: copy them so strict deepEqual compares plain shapes.
const settledOrPending = (promise: Promise<unknown>) =>
  Promise.race([promise, new Promise((resolve) => setImmediate(() => resolve("pending")))]).then((value) => JSON.parse(JSON.stringify(value)));
const SUBMIT = { source: "AMS", cmd: "submitPrompt", text: "q", deadline: Date.now() + 44_000 } as never;

test("while a reload waits to commit, broadcasts and collection get a retriable not_ready instead of typing into the old document", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const h = harness();
  try {
    const claude = h.views[0];
    h.manager.markStatus({ site: "claude", phase: "ready" });
    assert.equal(h.manager.reload("claude"), true);
    assert.deepEqual(await settledOrPending(h.manager.sendCommand("claude", SUBMIT, new AbortController().signal)), { ok: false, code: "not_ready" });
    assert.deepEqual(await settledOrPending(h.manager.collect("claude", Date.now() + 10_000)), { code: "not_ready" });
    assert.deepEqual([...claude.calls], ["reload"], "nothing was dispatched to the document that is about to be replaced or abandoned");
    claude.emit("did-navigate", {}, "https://claude.ai/new", 200, "OK");
    assert.equal(await settledOrPending(h.manager.sendCommand("claude", SUBMIT, new AbortController().signal)), "pending");
    assert.equal(claude.calls.at(-1), "send", "after the commit the new document receives the command");
  } finally { h.window.emit("closed"); }
});

test("a pending new-session / restore commit refuses reload, back/forward and site-data clears until it settles or is abandoned", async () => {
  const h = harness();
  const home = SITES.find((site) => site.key === "claude")!.url;
  try {
    const claude = h.views[0];
    h.manager.markStatus({ site: "claude", phase: "ready" });
    // 1) Commit: the navigation's own did-navigate settles it, then reload is allowed again.
    const committed = h.manager.navigate("claude", home, "commit");
    assert.equal(h.status("claude").phase, "loading");
    assert.equal(h.manager.reload("claude"), false, "Chromium would drop the pending loadURL and reload the old conversation");
    assert.equal(h.manager.navigateHistory("claude", -1), false);
    assert.deepEqual({ ...h.manager.canNavigateHistory("claude") }, { back: false, forward: false });
    assert.equal(await h.manager.clearSiteData("claude"), false);
    assert.deepEqual([...claude.calls], [], "the old document was never re-committed under the pending navigation");
    claude.emit("did-navigate", {}, home, 200, "OK");
    await committed;
    assert.equal(h.manager.reload("claude"), true);
    claude.emit("did-navigate", {}, home, 200, "OK");
    // 2) Abandon at the new-session cap clears the guard (the stopped loadURL never settles on its own).
    void h.manager.navigate("claude", home, "commit");
    assert.equal(h.manager.reload("claude"), false);
    h.manager.historyAccess.abandon("claude", claude.id);
    assert.equal(h.status("claude").code, "load_failed");
    assert.equal(h.manager.reload("claude"), true, "the user can reload after the cap");
    claude.emit("did-navigate", {}, home, 200, "OK");
    // 3) A plain stop() (history restore's fallback without a view id) clears the guard too.
    void h.manager.navigate("claude", home, "commit");
    h.manager.historyAccess.stop("claude", claude.id);
    assert.equal(h.manager.reload("claude"), true);
    // A full-load navigation (synthesis) is not guarded: a superseding reload just rejects it.
    claude.emit("did-navigate", {}, home, 200, "OK");
    void h.manager.navigate("claude", home, "load");
    assert.equal(h.manager.reload("claude"), true);
    claude.emit("did-navigate", {}, home, 200, "OK"); // settle the reload watch so no real cap timer outlives the test
  } finally { h.window.emit("closed"); }
});
