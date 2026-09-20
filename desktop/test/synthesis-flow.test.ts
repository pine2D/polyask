import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { ExclusiveActionLock } from "../src/renderer/broadcast-flow-state";
import { readSource } from "./fixtures";

test("synthesis holds the shared renderer lock and exposes cancel until the request settles", async () => {
  const states: unknown[] = [];
  let finish!: (response: unknown) => void;
  let cancelled = false;
  const module = { exports: {} as any };
  vm.runInNewContext(ts.transpileModule(readSource("src/renderer/use-synthesis-flow.ts"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText, {
    exports: module.exports,
    require: (name: string) => name === "react"
      ? { useState: (value: unknown) => [value, (next: unknown) => states.push(next)] }
      : { shell: { sendSynthesis: () => new Promise((resolve) => { finish = resolve; }), cancel: () => { cancelled = true; } } }
  });
  const lock = new ExclusiveActionLock();
  const flow = module.exports.useSynthesisFlow(lock);
  let prepared = 0;
  const sending = flow.send({}, () => { prepared++; });
  assert.equal(states[0], "sending");
  assert.equal(await lock.run(async () => "competing broadcast"), null);
  await assert.rejects(flow.send({}, () => { prepared++; }), /operation_busy/);
  assert.equal(prepared, 1, "rejected send must not navigate or invalidate the current run");
  flow.cancel();
  assert.equal(cancelled, true);
  assert.equal(states.at(-1), "cancelling");
  assert.equal(await lock.run(async () => "early navigation"), null);
  finish({result:{ok:false,code:"cancelled"},pending:null});
  await assert.rejects(sending, /cancelled/);
  assert.equal(states.at(-1), "idle");
  assert.equal(await lock.run(async () => "released"), "released");
});
