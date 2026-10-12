import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { readSource } from "./fixtures";

test("shell IPC registers the proxy channels on the shared gate after creating it and disposes them", () => {
  const source = readSource("src/main/shell-ipc.ts");
  assert.match(source, /registerProxyIpc\(\{ \.\.\.options\.proxy, trusted: trustedShell, gate: operationGate, dataAdmin: options\.dataAdmin,/);
  assert.match(source, /disposeProxyIpc\(\);/);
  assert.ok(source.indexOf("const operationGate = new OperationGate()") < source.indexOf("registerProxyIpc("),
    "bindBusySource 在 registerProxyIpc 里执行，必须晚于 OperationGate 创建");
  assert.match(readSource("src/main/proxy-ipc.ts"), /runtime\.bindBusySource\(gate, \(\) => options\.dataAdmin\.isResetting\);/,
    "重置标志是 bindBusySource 的第二个参数，不能夹带在 gate 对象里");
});

test("production assembly hands the local proxy services to the shell and the awaited reset hook", () => {
  const index = readSource("src/main/index.ts");
  assert.match(index, /dataAdmin, preferences, proxy,/, "registerShellIpc 收 createWindow 内的非空局部常量 proxy");
  assert.doesNotMatch(index, /proxyServices\.runtime|proxy: proxyServices/, "模块变量 proxyServices 可能为 null，不得直接传");
  assert.match(readSource("src/main/window-data-services.ts"), /wipeSecrets: \(\) => options\.proxy\.runtime\.wipeSecrets\(\)/);
});

test("every proxy preload method goes through the unwrapping invoke helper", () => {
  const preload = readSource("src/preload/shell.ts");
  for (const channel of ["polyask:proxy-state", "polyask:proxy-set", "polyask:proxy-follow", "polyask:proxy-accept",
    "polyask:proxy-test", "polyask:proxy-reload-sites"]) {
    assert.match(preload, new RegExp(`=> invoke\\("${channel}"`), channel);
  }
  assert.match(preload, /subscribe\("polyask:proxy-state-changed", listener\)/);
});

test("proxy IPC returns result codes and never emits code literals", () => {
  assert.doesNotMatch(readSource("src/main/proxy-ipc.ts"), /\bcode:\s*["']/);
  assert.doesNotMatch(readSource("src/main/proxy-ipc.ts"), /new Error\(["']proxy_/);
});

// 写通道是 proxy 配置唯一的写路径，落盘只经 ProxyPreferenceStore；字面量键的写入由 preferences-proxy-boundary 守着，
// 这里补上经常量键的写入（proxy-ipc 这类模块 import 了常量，最容易绕过 store 直接 put/delete）。
test("no main-process module outside the store writes proxy keys through the exported constants", () => {
  const writer = /\.(?:put|delete)\(\s*PROXY_(?:OVERRIDE|FOLLOWING|ACCEPTED|STATE)_KEY/;
  const offenders = readdirSync(path.join(__dirname, "..", "src", "main"))
    .filter(name => name.endsWith(".ts") && name !== "proxy-preference-store.ts")
    .filter(name => writer.test(readSource(`src/main/${name}`)));
  assert.deepEqual(offenders, []);
  assert.match(readSource("src/main/proxy-preference-store.ts"), writer, "正则仍能命中 store 里的真实写法，不是空守卫");
});
