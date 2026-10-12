import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { readSource } from "./fixtures";

test("startup applies the proxy (or blocks) before the first site view can load", () => {
  const main = readSource("src/main/index.ts");
  const gates = main.indexOf("const runtimeGates = startRuntimeGates(window);");
  const apply = main.indexOf("await proxy.runtime.recomputeFromStore();");
  // ViewManager 的构造经 ensureSiteViews → createView → historyAccess.initialLoad 直接 loadURL（spec §3.3）。
  const views = main.indexOf("new ViewManager(");
  const shellLoad = main.indexOf("await window.loadURL(MAIN_WINDOW_WEBPACK_ENTRY);");
  const syncStart = main.indexOf("sync.start();");
  assert.ok(gates > 0, "anchor: runtime gates start first");
  assert.ok(apply > gates, "the proxy is applied after the runtime gates");
  assert.ok(views > apply, "no site view exists before the proxy is applied and verified");
  assert.ok(shellLoad > apply && syncStart > apply, "the shell page and Drive come after the proxy too");
  assert.equal(main.split("recomputeFromStore(").length, 2, "exactly one startup apply");
  assert.match(main, /webrtcPolicy: \(\) => proxy\.runtime\.webrtcPolicy\(\),/);
  assert.match(main, /const proxy = proxyServices;\n\s*if \(!proxy\) throw new Error\("proxy_not_ready"\);/);
  assert.doesNotMatch(main, /onProxyLogin/, "the request-level login is wired once, inside window-data-services");
});

test("proxy services are built once per process, after the profile identity and before the first window", () => {
  const main = readSource("src/main/index.ts");
  const open = main.indexOf("DesktopDatabase.open(");
  const identity = main.indexOf("applyPortableImportIdentity(runtimeProfile", open);
  const services = main.indexOf("proxyServices = createProxyServices(desktopDatabase);");
  const firstWindow = main.indexOf("await createWindow();", open);
  assert.ok(open > 0 && identity > open && services > identity && firstWindow > services);
  assert.equal(main.split("createProxyServices(").length, 2, "macOS activate re-runs createWindow, never the assembly");
  assert.match(main, /coordinator, synthesisCoordinator, proxy, publish: sendToShell,/);
});

test("only the proxy assembly listens for app-level login", () => {
  // 只看代码：proxy-auth.ts 的 JSDoc 提到 app.on('login') 但不注册监听。
  const code = (name: string) => readSource(`src/main/${name}`).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  const owners = readdirSync(join(__dirname, "../src/main"))
    .filter((name) => name.endsWith(".ts") && /\bapp\.on\(\s*["']login["']/.test(code(name)));
  assert.deepEqual(owners, ["proxy-services.ts"]);
});

test("refresh only marks the proxy dirty, views read the live policy, and Drive 407s share proxy-auth", () => {
  const services = readSource("src/main/window-data-services.ts");
  assert.match(services, /options\.setNotifications,\s*\(\) => options\.proxy\.runtime\.request\(\)\);/);
  assert.match(services, /createSyncRuntime\(\{[^}]*?onProxyLogin: \(request, authInfo, callback\) => options\.proxy\.auth\.handleRequestLogin\(request, authInfo, callback\),/);
  assert.equal(services.split("onProxyLogin").length, 2, "one login wiring, no leftover optional pass-through");
  const runtime = readSource("src/main/sync-runtime.ts");
  assert.match(runtime, /createSessionFetch\([^;]*\{ onLogin: options\.onProxyLogin \}\)/, "T10's adapter wiring stays as is");
  assert.doesNotMatch(runtime, /\bproxyLogin\b/, "no second, differently named login option");
  assert.match(readSource("src/main/view-manager.ts"), /webrtcPolicy: \(\) => this\.options\.webrtcPolicy\?\.\(\) \?\? "default"/);
  assert.match(readSource("src/main/site-view.ts"), /contents\.setWebRTCIPHandlingPolicy\(callbacks\.webrtcPolicy\(\)\);/);
});
