import assert from "node:assert/strict";
import test from "node:test";
import { OperationGate } from "../src/shared/operation-gate";

test("broadcast, synthesis and navigation cannot overlap until the active task settles", async () => {
  const gate = new OperationGate();
  let finish!: () => void;
  const active = gate.run(() => new Promise<void>((resolve) => { finish = resolve; }));
  let started = false;
  await assert.rejects(gate.run(async () => { started = true; }), /operation_busy/);
  assert.equal(started, false);
  finish(); await active;
  await gate.run(async () => { started = true; });
  assert.equal(started, true);
  await assert.rejects(gate.run(async () => { throw new Error("failed"); }), /failed/);
  assert.equal(await gate.run(async () => "released"), "released");
});
