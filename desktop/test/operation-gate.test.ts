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

test("busy mirrors the active run and idle listeners fire after every settled run", async () => {
  const gate = new OperationGate();
  const seen: string[] = [];
  const stop = gate.onIdle(() => { seen.push(`idle:${gate.busy}`); });
  assert.equal(gate.busy, false);
  let finish!: () => void;
  const active = gate.run(() => new Promise<void>((resolve) => { finish = resolve; }));
  assert.equal(gate.busy, true);
  await assert.rejects(gate.run(async () => undefined), /operation_busy/);
  assert.deepEqual(seen, [], "a rejected busy attempt is not an idle transition");
  finish(); await active;
  assert.equal(gate.busy, false);
  await assert.rejects(gate.run(async () => { throw new Error("failed"); }), /failed/);
  assert.deepEqual(seen, ["idle:false", "idle:false"], "idle fires after success and after failure, with busy already false");
  stop();
  await gate.run(async () => undefined);
  assert.equal(seen.length, 2, "unsubscribed listeners stay silent");
});

test("a faulty idle listener cannot wedge the gate or change the run result", async () => {
  const gate = new OperationGate();
  let later = 0;
  gate.onIdle(() => { throw new Error("listener"); });
  gate.onIdle(() => { later++; });
  assert.equal(await gate.run(async () => "value"), "value");
  assert.equal(later, 1);
  assert.equal(gate.busy, false);
  assert.equal(await gate.run(async () => "again"), "again");
});

test("an idle listener may claim the gate for the deferred work right away", async () => {
  const gate = new OperationGate();
  const follow: Promise<string>[] = [];
  const stop = gate.onIdle(() => { stop(); follow.push(gate.run(async () => "deferred")); });
  assert.equal(await gate.run(async () => "first"), "first");
  assert.equal(follow.length, 1);
  assert.equal(await follow[0], "deferred");
  assert.equal(gate.busy, false);
});
