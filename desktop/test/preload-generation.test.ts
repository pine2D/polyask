import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { createRequire } from "node:module";
import path from "node:path";
import ts from "typescript";
import { readSource } from "./fixtures";
import type { SiteCommandEnvelope, SiteResponseEnvelope } from "../src/shared/protocol";

// 回答状态探测走 generation.js 的 generationProbe（complete 上叠加本次提交的停止键锁存）；缺失时退回逐站钩子。
async function generationFor(runtime: Record<string, unknown>): Promise<unknown> {
  let receive!: (event: unknown, envelope: SiteCommandEnvelope) => Promise<void>;
  let sent!: SiteResponseEnvelope;
  const realRequire = createRequire(path.join(__dirname, "../src/preload/site.ts"));
  const context = vm.createContext({
    exports: {}, navigator: { language: "en" }, setTimeout, clearTimeout, location: { hostname: "chatgpt.com" },
    require(name: string) {
      if (name === "electron") return { ipcRenderer: {
        on(_channel: string, handler: typeof receive) { receive = handler; },
        send(_channel: string, envelope: SiteResponseEnvelope) { sent = envelope; }
      } };
      if (name.startsWith("../site-runtime/")) return {};
      return realRequire(name);
    }
  });
  vm.runInContext(ts.transpileModule(readSource("src/preload/site.ts"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
  }).outputText, context);
  context.__AMS = runtime;
  await receive(null, { requestId: "request", command: { source: "AMS", cmd: "generation", runId: "run", deadline: Date.now() + 1_000 } });
  return JSON.parse(JSON.stringify(sent.result));
}

test("the generation probe reports the latched completion through the preload whitelist", async () => {
  const adapters = { "chatgpt.com": { generation: () => "complete" } };
  assert.deepEqual(await generationFor({ adapters, generationProbe: () => "complete_observed" }), { state: "complete_observed" });
  assert.deepEqual(await generationFor({ adapters }), { state: "complete" }, "没有 generationProbe 时退回逐站钩子");
  assert.deepEqual(await generationFor({ adapters, generationProbe: () => "finished" }), { state: null }, "白名单外的值一律 null");
  assert.deepEqual(await generationFor({ adapters, generationProbe: () => { throw new Error("boom"); } }), { state: null });
});
