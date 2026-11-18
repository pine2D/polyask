import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { createRequire } from "node:module";
import path from "node:path";
import ts from "typescript";
import { readSource } from "./fixtures";
import type { SiteCommandEnvelope, SiteResponseEnvelope } from "../src/shared/protocol";

type Handler = (message: unknown, respond: (value: unknown) => void) => true | void;
async function dispatchFor(handler?: Handler, cmd: "submitPrompt" | "wasSubmitted" = "submitPrompt",
  budget = 1_000): Promise<SiteResponseEnvelope["result"]> {
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
      if (name.startsWith("../site-runtime/")) return {};
      return realRequire(name);
    }, __AMS: handler ? { handleCommand: handler } : {}
  });
  vm.runInContext(ts.transpileModule(readSource("src/preload/site.ts"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
  }).outputText, context);
  const deadline = Date.now() + budget;
  await receive(null, { requestId: "request", command: cmd === "wasSubmitted"
    ? { source: "AMS", cmd, text: "question", deadline }
    : { source: "AMS", cmd, text: "question", tier: "think", images: [], deadline } });
  return JSON.parse(JSON.stringify(sent.result));
}

const responseFor = (value: unknown) => dispatchFor((_message, respond) => respond(value));

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

test("the isolated command bridge settles once and preserves uncertain submissions", async () => {
  assert.deepEqual(await dispatchFor(), { ok: false, code: "adapter_unavailable" });
  assert.deepEqual(await dispatchFor(() => {}), { ok: false, code: "invalid_response" });
  assert.deepEqual(await dispatchFor(() => true, "submitPrompt", 25), { ok: false, code: "submit_unconfirmed" });
  assert.deepEqual(await dispatchFor((_message, respond) => {
    queueMicrotask(() => { respond({ ok: true }); respond({ ok: false }); });
    return true;
  }), { ok: true });
  const unsupported = { supported: false, ok: false };
  for (const handler of [undefined, () => {}, () => { throw Error("unavailable"); },
    ((_message, respond) => respond({ ok: false })) as Handler, (() => true) as Handler]) {
    assert.deepEqual(await dispatchFor(handler, "wasSubmitted", 25), unsupported);
  }
  assert.deepEqual(await dispatchFor((_message, respond) => respond({ supported: true, ok: false }), "wasSubmitted"),
    { supported: true, ok: false });
});
