import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter } from "node:events";

import { RELOAD_COMMIT_CAP_MS } from "../src/main/reload-commit";
import { SiteHistoryAccess } from "../src/main/site-history-access";
import { SITES } from "../src/main/sites";
import { viewManagerHarness } from "./view-manager-harness";

const ready = (h: ReturnType<typeof viewManagerHarness>, index = 0) => {
  h.views[index].callbacks.onReady();
  assert.equal(h.status(SITES_KEYS[index]).phase, "ready");
};
const SITES_KEYS = ["claude", "chatgpt"];
const plain = (h: ReturnType<typeof viewManagerHarness>, site: string) => {
  const status = h.status(site);
  return { phase: status.phase, code: status.code ?? null };
};

// R14：后退/前进落到同文档历史条目（SPA）时只有 did-start-navigation(isSameDocument) + did-navigate-in-page，
// PageLifecycle 不会给 ready，旧写法永久停在 loading（重载、群发、健康检查都被这个 loading 卡住）。
test("a same-document back step settles back to the page's phase instead of loading forever", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const h = viewManagerHarness();
  try {
    const claude = h.views[0];
    ready(h);
    assert.equal(h.manager.navigateHistory("claude", -1), true);
    assert.equal(h.status("claude").phase, "loading");
    claude.emit("did-start-navigation", { isMainFrame: true, isSameDocument: true });
    claude.emit("did-navigate-in-page", {}, "https://claude.ai/chat/a", true);
    assert.deepEqual(plain(h, "claude"), { phase: "ready", code: null });
    assert.equal(h.manager.reload("claude"), true, "reload is available again right away");
    claude.emit("did-navigate", {}, "https://claude.ai/chat/a", 200, "OK");
    t.mock.timers.tick(RELOAD_COMMIT_CAP_MS * 2);
    assert.equal(claude.calls.includes("stop"), false, "the step's cap was retired, nothing is aborted later");
  } finally { h.window.emit("closed"); }
});

test("a subframe's in-page navigation is not the history step settling", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const h = viewManagerHarness();
  try {
    ready(h);
    h.manager.navigateHistory("claude", -1);
    h.views[0].emit("did-navigate-in-page", {}, "https://ads.example/#x", false);
    assert.equal(h.status("claude").phase, "loading");
  } finally { h.window.emit("closed"); }
});

// R14：跨文档后退此前没有提交上限——文档请求挂住时 Electron 不报 did-fail-load，站点停在 loading 无出路。
test("a cross-document back step that never commits is capped like a reload", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const h = viewManagerHarness();
  try {
    const claude = h.views[0];
    ready(h);
    assert.equal(h.manager.navigateHistory("claude", -1), true);
    claude.emit("did-start-navigation", { isMainFrame: true, isSameDocument: false });
    t.mock.timers.tick(RELOAD_COMMIT_CAP_MS - 1);
    assert.equal(h.status("claude").phase, "loading");
    t.mock.timers.tick(1);
    assert.deepEqual(plain(h, "claude"), { phase: "failed", code: "load_failed" });
    assert.equal(claude.calls.at(-1), "stop");

    // A back step that commits in time is never touched, and a later in-page change is not mistaken for it.
    ready(h);
    assert.equal(h.manager.navigateHistory("claude", -1), true);
    claude.emit("did-start-navigation", { isMainFrame: true, isSameDocument: false });
    claude.emit("did-navigate", {}, "https://claude.ai/chat/a", 200, "OK");
    claude.emit("did-navigate-in-page", {}, "https://claude.ai/chat/b", true);
    assert.equal(h.status("claude").phase, "loading", "readiness of the new document comes from did-finish-load");
    t.mock.timers.tick(RELOAD_COMMIT_CAP_MS * 2);
    assert.equal(claude.calls.filter(call => call === "stop").length, 1);
  } finally { h.window.emit("closed"); }
});

// R13：站点 beforeunload 要挽留时 Electron 发 will-prevent-unload 并静默取消导航——新会话 20s 后被钉 load_failed，
// 重载停在旧文档上。应用发起的导航忽略挽留；提交后站点自己的导航不受影响。
test("app-initiated navigations ignore the site's beforeunload; the site's own navigations keep it", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const h = viewManagerHarness();
  const home = SITES.find(site => site.key === "claude")!.url;
  const unload = (contents: EventEmitter) => {
    let prevented = false;
    contents.emit("will-prevent-unload", { preventDefault: () => { prevented = true; } });
    return prevented;
  };
  try {
    const claude = h.views[0];
    ready(h);
    assert.equal(unload(claude), false, "no app navigation pending: the site's own prompt stands");
    assert.equal(h.manager.reload("claude"), true);
    assert.equal(unload(claude), true, "reload");
    claude.emit("did-navigate", {}, home, 200, "OK");
    assert.equal(unload(claude), false, "released once the reload committed");

    const committed = h.manager.navigate("claude", home, "commit");
    assert.equal(unload(claude), true, "new session / history restore");
    claude.emit("did-navigate", {}, home, 200, "OK");
    await committed;
    assert.equal(unload(claude), false);

    ready(h);
    assert.equal(h.manager.navigateHistory("claude", -1), true);
    assert.equal(unload(claude), true, "back / forward");
    claude.emit("did-fail-load", {}, -105, "", home, true);
    assert.equal(unload(claude), false, "released by a real main-frame failure");

    ready(h);
    h.manager.reload("claude");
    t.mock.timers.tick(RELOAD_COMMIT_CAP_MS);
    assert.equal(unload(claude), false, "never outlives the commit cap");
  } finally { h.window.emit("closed"); }
});

// R17：首次加载 `void contents.loadURL()` 的拒绝没人接，是未处理拒绝。
test("a rejected first load is left to did-fail-load instead of becoming an unhandled rejection", async () => {
  const unhandled: unknown[] = [];
  const record = (reason: unknown) => unhandled.push(reason);
  process.on("unhandledRejection", record);
  try {
    const page = Object.assign(new EventEmitter(), {
      id: 3, isDestroyed: () => false, getURL: () => "",
      loadURL: () => Promise.reject(Object.assign(new Error("ERR_CONNECTION_REFUSED"), { errno: -102 }))
    });
    const access = new SiteHistoryAccess(() => ({ webContents: page }) as never, {} as never, () => {});
    access.initialLoad("claude", page as never, "https://claude.ai/new");
    await new Promise(resolve => setImmediate(resolve));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(unhandled.length, 0);
    access.reloads.replace("claude");
  } finally { process.off("unhandledRejection", record); }
});
