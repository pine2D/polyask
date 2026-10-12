import assert from "node:assert/strict";
import test from "node:test";

import { readSource } from "./fixtures";

// 源码守卫：sync-runtime.ts 依赖 electron，单测里没法实例化，只能核对装配。
// Drive/OAuth 必须走 net.request 适配器（polyask-net 会话），这样才受代理设置、请求级 login、
// 跨源重定向剥 Authorization 这几条约束管辖。Node 全局 fetch 不走代理；
// session.fetch / net.fetch 也会绕开适配器的重定向与 login 处理。
test("production Drive and OAuth requests go through the polyask-net session adapter", () => {
  const runtime = readSource("src/main/sync-runtime.ts");
  assert.match(runtime, /const netFetch = createSessionFetch\(electronSession\.fromPartition\(NET_PARTITION\)/);
  assert.match(runtime, /new DriveClient\(oauth, netFetch\)/);
  assert.match(runtime, /new OAuthSession\(\{[^}]*?\bfetch: netFetch,/, "OAuthSession must receive the adapter before openExternal");
  assert.doesNotMatch(runtime, /new DriveClient\(oauth\)/);
  assert.doesNotMatch(runtime, /globalThis\.fetch/);
  assert.doesNotMatch(runtime, /\.fetch\b/, "session.fetch / net.fetch bypass the adapter's redirect and login handling");
});

test("the Drive and OAuth partition is in-memory", () => {
  const value = readSource("src/main/proxy-sessions.ts").match(/export const NET_PARTITION = "([^"]+)";/)?.[1];
  assert.equal(value, "polyask-net");
});

test("window data services hand proxy-auth's request-level login to the sync runtime", () => {
  const services = readSource("src/main/window-data-services.ts");
  assert.match(services, /readonly proxy: ProxyServices;/);
  assert.match(services, /createSyncRuntime\(\{[^}]*?onProxyLogin: \(request, authInfo, callback\) => options\.proxy\.auth\.handleRequestLogin\(request, authInfo, callback\),/);
  assert.doesNotMatch(services, /onProxyLogin\?:/, "the assembly always wires proxy-auth; no optional pass-through left");
});
