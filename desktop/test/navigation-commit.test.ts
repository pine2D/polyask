import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter } from "node:events";
import { loadUntil } from "../src/main/navigation-commit";
import { SiteHistoryAccess } from "../src/main/site-history-access";
import { OperationGate } from "../src/shared/operation-gate";
import { DesktopDatabase } from "../src/main/database";
import { NEW_SESSION_COMMIT_CAP_MS, WorkspaceService } from "../src/main/workspace-service";
import { readSource } from "./fixtures";

const turn = () => new Promise<void>((resolve) => setImmediate(resolve));

// A webContents whose loadURL only settles when the test says so: did-finish-load can lag the
// main-frame commit by 23–48s on real sites, and Claude can stay waiting for a response forever.
function slowContents(url = "https://claude.ai/chat/1") {
  let finish: () => void = () => {};
  let fail: (error: Error) => void = () => {};
  const loads: string[] = [];
  const contents = Object.assign(new EventEmitter(), {
    id: 4, loads,
    isDestroyed: () => false,
    getURL: () => url,
    loadURL(target: string) {
      loads.push(target);
      return new Promise<void>((resolve, reject) => { finish = resolve; fail = reject; });
    }
  });
  return { contents, finish: () => finish(), fail: (error: Error) => fail(error) };
}

async function state(promise: Promise<unknown>): Promise<string> {
  let result = "pending";
  promise.then(() => { result = "resolved"; }, () => { result = "rejected"; });
  await turn();
  return result;
}

test("commit waits resolve at did-navigate even while did-finish-load is still outstanding", async () => {
  const h = slowContents();
  const navigation = loadUntil(h.contents, "https://claude.ai/new", "commit");
  assert.equal(await state(navigation), "pending");
  h.contents.emit("did-navigate", {}, "https://claude.ai/new", 200, "OK");
  assert.equal(await state(navigation), "resolved");
  for (const event of ["did-navigate", "did-fail-load", "destroyed"]) assert.equal(h.contents.listenerCount(event), 0, event);
  // The page may still abort its own load later (ERR_ABORTED from a script redirect): already settled, never unhandled.
  h.fail(new Error("ERR_ABORTED (-3)"));
  await turn();
});

test("commit waits fail on a main-frame load failure or a destroyed view, but ignore subframe failures", async () => {
  const sub = slowContents();
  const navigation = loadUntil(sub.contents, "https://claude.ai/new", "commit");
  sub.contents.emit("did-fail-load", {}, -105, "", "https://ads.example/", false);
  assert.equal(await state(navigation), "pending");
  // 旧文档仍在加载时，新导航提交前会先为旧文档发一次主帧 ERR_ABORTED（Linux 真机 ChatGPT：-3 后 16ms 即 did-navigate）。
  sub.contents.emit("did-fail-load", {}, -3, "", "https://claude.ai/chat/1", true);
  assert.equal(await state(navigation), "pending", "the outgoing document's ERR_ABORTED is not this navigation failing");
  sub.contents.emit("did-fail-load", {}, -105, "", "https://claude.ai/new", true);
  assert.equal(await state(navigation), "rejected");
  const gone = slowContents();
  const destroyed = loadUntil(gone.contents, "https://claude.ai/new", "commit");
  gone.contents.emit("destroyed");
  assert.equal(await state(destroyed), "rejected");
  const refused = slowContents();
  const blocked = loadUntil(refused.contents, "https://claude.ai/new", "commit");
  refused.fail(new Error("ERR_BLOCKED_BY_CLIENT (-20)"));
  assert.equal(await state(blocked), "rejected", "a rejection before any commit is still a failure");
});

test("commit waits ignore loadURL settling before the commit: the outgoing document can finish or abort first", async () => {
  // Linux 真机：元宝旧文档仍在加载，新 loadURL 发起后旧文档 1654ms did-finish-load、loadURL 随之 resolve，新导航 2933ms 才提交。
  const early = slowContents();
  const resolvedEarly = loadUntil(early.contents, "https://yuanbao.tencent.com/", "commit");
  early.finish();
  assert.equal(await state(resolvedEarly), "pending", "an early loadURL resolve is not this navigation committing");
  early.contents.emit("did-navigate", {}, "https://yuanbao.tencent.com/", 200, "OK");
  assert.equal(await state(resolvedEarly), "resolved");
  const abort = slowContents();
  const abortedEarly = loadUntil(abort.contents, "https://chatgpt.com/", "commit");
  abort.fail(Object.assign(new Error("ERR_ABORTED (-3) loading 'https://chatgpt.com/'"), { code: "ERR_ABORTED", errno: -3 }));
  assert.equal(await state(abortedEarly), "pending", "ERR_ABORTED before commit is left to the caller's hard cap");
  abort.contents.emit("did-navigate", {}, "https://chatgpt.com/", 200, "OK");
  assert.equal(await state(abortedEarly), "resolved");
});

test("load waits keep the old did-finish-load semantics for callers that send right after navigating", async () => {
  const h = slowContents();
  const navigation = loadUntil(h.contents, "https://claude.ai/new", "load");
  h.contents.emit("did-navigate", {}, "https://claude.ai/new", 200, "OK");
  assert.equal(await state(navigation), "pending");
  h.finish();
  assert.equal(await state(navigation), "resolved");
});

test("history navigation defaults to commit; an explicit load still waits for the full page", async () => {
  const h = slowContents("https://claude.ai/");
  const invalidated: string[] = [];
  const access = new SiteHistoryAccess(() => ({ webContents: h.contents }) as never, {} as never, (site) => invalidated.push(site));
  const restore = access.navigate("claude", "https://claude.ai/chat/0f6c1a52-6a1e-4d0b-9a7d-9b8f7a2f0c11");
  assert.deepEqual(invalidated, ["claude"], "the view is invalidated before the navigation starts");
  h.contents.emit("did-navigate", {}, "https://claude.ai/chat/0f6c1a52-6a1e-4d0b-9a7d-9b8f7a2f0c11", 200, "OK");
  assert.equal(await state(restore), "resolved");
  const synthesis = access.navigate("claude", "https://claude.ai/new", true, "load");
  h.contents.emit("did-navigate", {}, "https://claude.ai/new", 200, "OK");
  assert.equal(await state(synthesis), "pending");
  h.finish();
  assert.equal(await state(synthesis), "resolved");
});

test("new session no longer holds the operation gate until every page finishes loading (NEW-4)", { timeout: 3_000 }, async () => {
  const database = DesktopDatabase.open(":memory:");
  try {
    const commits = new Map<string, () => void>();
    const abandoned: string[] = [];
    const ids: Record<string, number> = { claude: 11, chatgpt: 12, kimi: 13 };
    const service = new WorkspaceService(database.state, database.meta, (site) => {
      if (site === "claude") return new Promise<void>(() => {}); // stuck waiting for a response
      return new Promise<void>((resolve) => commits.set(site, resolve));
    }, { navigationCapMs: 40, context: (site) => ids[site], abandon: (site, id) => abandoned.push(`${site}:${id}`) });
    const gate = new OperationGate();
    const session = gate.run(() => service.newSession(["claude", "chatgpt", "kimi"]));
    await turn();
    commits.get("chatgpt")!();
    commits.get("kimi")!();
    await assert.rejects(() => gate.run(async () => "broadcast"), /operation_busy/);
    assert.deepEqual(await session, [
      { site: "claude", ok: false, code: "not_ready" },
      { site: "chatgpt", ok: true },
      { site: "kimi", ok: true }
    ]);
    assert.deepEqual(abandoned, ["claude:11"], "the uncommitted navigation is abandoned before the gate opens; committed sites are untouched");
    assert.equal(await gate.run(async () => "broadcast"), "broadcast", "the gate is free once the cap expires");
  } finally {
    database.close();
  }
});

test("abandoning an uncommitted navigation stops it and pins the site as load_failed instead of leaving the old document live", () => {
  const h = slowContents("https://claude.ai/chat/old");
  let stops = 0;
  const calls: string[] = [];
  const contents = Object.assign(h.contents, { stop: () => { stops++; calls.push("stop"); } });
  const access = new SiteHistoryAccess(() => ({ webContents: contents }) as never, {} as never,
    (site, abandoned) => calls.push(`${site}:${abandoned ? "failed" : "loading"}`));
  access.abandon("claude", 99);
  assert.equal(stops, 0, "a replaced view (different contents id) is left alone");
  access.abandon("claude", 4);
  assert.deepEqual(calls, ["stop", "claude:failed"], "stop first, then mark failed so a synchronous late event cannot win");
  // sendCommand's existing guard turns the failed phase into a certain, undispatched load_failed.
  const manager = readSource("src/main/view-manager.ts");
  assert.match(manager, /abandoned \? \{ site, phase: "failed", code: "load_failed" \}/);
  assert.match(manager, /if \(phase === "failed"\) return "load_failed";/);
  assert.match(readSource("src/main/index.ts"), /abandon: \(site, contentsId\) => managerForWorkspace\?\.historyAccess\.abandon\(site, contentsId\)/);
});

test("the new-session cap keeps at least 20% margin over the slowest observed main-frame commit", () => {
  // Windows live runs: 96–3557ms from navigation start to did-navigate across 18 navigations; round 6 (2026-10-05)
  // saw ChatGPT's cookie-bearing HTML take ~13s on a slow network, so the old 10s cap failed a page that was only slow.
  assert.ok(NEW_SESSION_COMMIT_CAP_MS >= 3_557 * 1.2);
  assert.ok(NEW_SESSION_COMMIT_CAP_MS >= 13_000 * 1.2);
  // …and must stay well below the 23–48s did-finish-load hold it replaces.
  assert.ok(NEW_SESSION_COMMIT_CAP_MS <= 20_000);
});

test("new session and history restore wait for commit; synthesis keeps waiting for the full load", () => {
  const main = readSource("src/main/index.ts");
  assert.match(main, /managerForWorkspace\.navigate\(site, url, "commit"\)/);
  assert.match(main, /navigate: \(site, url\) => manager\.navigate\(site, url\),/, "synthesis sends right after navigating");
  const manager = readSource("src/main/view-manager.ts");
  assert.match(manager, /async navigate\(site: SiteKey, url: string, until: "load" \| "commit" = "load"\)/);
  const history = readSource("src/main/question-history-ipc.ts");
  assert.match(history, /navigate: \(site, url\) => manager\.historyAccess\.navigate\(site, url\),/);
});
