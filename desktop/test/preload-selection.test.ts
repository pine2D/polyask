import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { createRequire } from "node:module";
import path from "node:path";
import ts from "typescript";
import { readSource } from "./fixtures";
import type { SiteCommandEnvelope, SiteResponseEnvelope } from "../src/shared/protocol";

async function responseFor(value: unknown): Promise<SiteResponseEnvelope["result"]> {
  let receive!: (event: unknown, envelope: SiteCommandEnvelope) => Promise<void>;
  let sent!: SiteResponseEnvelope;
  const realRequire = createRequire(path.join(__dirname, "../src/preload/site.ts"));
  const context = vm.createContext({
    exports: {}, navigator: { language: "en" }, setTimeout, clearTimeout,
    require(name: string) {
      if (name === "electron") return { ipcRenderer: {
        on(_channel: string, handler: typeof receive) { receive = handler; },
        send(_channel: string, envelope: SiteResponseEnvelope) { sent = envelope; }
      } };
      if (name === "../site-runtime/core.js") {
        vm.runInContext("chrome.runtime.onMessage.addListener((_message, _sender, respond) => { respond(runtimeResult); return true; })", context);
        return {};
      }
      if (name.startsWith("../site-runtime/")) return {};
      return realRequire(name);
    }, runtimeResult: value
  });
  vm.runInContext(ts.transpileModule(readSource("src/preload/site.ts"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
  }).outputText, context);
  await receive(null, { requestId: "request", command: {
    source: "AMS", cmd: "submitPrompt", text: "question", tier: "think", images: [], deadline: Date.now() + 1_000
  } });
  return JSON.parse(JSON.stringify(sent.result));
}

test("preload admits only bounded runtime confirmation metadata while preserving old responses", async () => {
  const selection = { requested: "think", outcome: "preferred", observed: "think", model: "Known model" };
  assert.deepEqual(await responseFor({ ok: false, code: "attachment_failed", selection, submissionEvidence: "composer", privateText: "secret" }), {
    ok: false, code: "attachment_failed", selection, submissionEvidence: "composer"
  });
  assert.deepEqual(await responseFor({ ok: true, selection: { ...selection, observed: "fast" }, submissionEvidence: "unknown" }), {
    ok: true, selection: { requested: "think", outcome: "unconfirmed" }
  });
  assert.deepEqual(await responseFor({ ok: true }), { ok: true });
  assert.deepEqual(await responseFor({ ok: true, selection: { ...selection, requested: null } }), { ok: true });
});
