import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { createRequire } from "node:module";
import path from "node:path";
import ts from "typescript";
import { readSource } from "./fixtures";
import type { SiteCommandEnvelope, SiteResponseEnvelope } from "../src/shared/protocol";

type Handler = (message: unknown, respond: (value: unknown) => void) => true | void;
async function dispatchFor(handler?: Handler | "core", cmd: "submitPrompt" | "wasSubmitted" | "collect" | "diagnose" = "submitPrompt",
  budget = 1_000): Promise<SiteResponseEnvelope["result"]> {
  let receive!: (event: unknown, envelope: SiteCommandEnvelope) => Promise<void>;
  let sent!: SiteResponseEnvelope;
  const realRequire = createRequire(path.join(__dirname, "../src/preload/site.ts"));
  const context = vm.createContext({
    exports: {}, navigator: { language: "en" }, location: { hostname: "fixture.test" }, document: {}, setTimeout, clearTimeout,
    require(name: string) {
      if (name === "electron") return { ipcRenderer: {
        on(channel: string, handler: typeof receive) { if (channel === "polyask:site-command") receive = handler; },
        send(_channel: string, envelope: SiteResponseEnvelope) { sent = envelope; }
      } };
      if (name.startsWith("../site-runtime/")) {
        if (handler === "core" && (name.endsWith("/core.js") || name.endsWith("/read-commands.js"))) {
          vm.runInContext(readSource("src/site-runtime/" + path.basename(name)), context);
        }
        return {};
      }
      return realRequire(name);
    }, __AMS: handler ? { handleCommand: handler } : {}
  });
  vm.runInContext("globalThis.window = globalThis", context);
  vm.runInContext(ts.transpileModule(readSource("src/preload/site.ts"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
  }).outputText, context);
  if (handler === "core") vm.runInContext(`__AMS.adapters["fixture.test"] = {
    submitted: text => text === "question", answer: () => "synthetic answer", state: () => "fast",
    diagnose: () => [{ name: "fixture control", kind: "control", ok: true }]
  }`, context);
  const base = { source: "AMS" as const, deadline: Date.now() + budget };
  const command = cmd === "submitPrompt" ? { ...base, cmd, text: "question", tier: "think" as const, images: [] }
    : cmd === "wasSubmitted" ? { ...base, cmd, text: "question" } : { ...base, cmd };
  await receive(null, { requestId: "request", command });
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

test("production preload and classic-script core exchange only the intended read-only responses", async () => {
  assert.deepEqual(await dispatchFor("core", "wasSubmitted"), { supported: true, ok: true });
  assert.deepEqual(await dispatchFor("core", "collect"), { text: "synthetic answer", state: "fast" });
  assert.deepEqual(await dispatchFor("core", "diagnose"), { checks: [{ name: "fixture control", ok: true, kind: "control" }] });
  assert.deepEqual(await dispatchFor("core", "wasSubmitted", 0), { supported: false, ok: false });
  assert.deepEqual(await dispatchFor("core", "submitPrompt", 0), { ok: false, code: "timeout" });
});
