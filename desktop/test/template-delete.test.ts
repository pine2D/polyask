import assert from "node:assert/strict";
import test from "node:test";
import { UndoableDeletions } from "../src/renderer/template-delete";

test("template deletes can be undone before any tombstone is written", () => {
  const timers: Array<() => void> = [];
  const written: string[] = [];
  const queue = new UndoableDeletions((id) => { written.push(id); }, () => {}, (fn) => { timers.push(fn); return timers.length; }, () => {});
  queue.add("one"); queue.add("two"); queue.add("one");
  assert.deepEqual(queue.ids, ["one", "two"]);
  assert.deepEqual(written, []);
  queue.undo(); timers.forEach((fn) => fn());
  assert.deepEqual(written, []);
  queue.add("three"); timers.at(-1)!();
  assert.deepEqual(written, ["three"]);
  assert.deepEqual(queue.ids, []);
});

test("an obsolete timer cannot delete a newly queued copy of the same template", () => {
  const timers: Array<() => void> = [];
  const written: string[] = [];
  const queue = new UndoableDeletions((id) => { written.push(id); }, () => {}, (fn) => { timers.push(fn); return timers.length; }, () => {});
  queue.add("one"); queue.undo(); queue.add("one");
  timers[0](); assert.deepEqual(written, []);
  timers[1](); assert.deepEqual(written, ["one"]);
  queue.add("two"); queue.dispose(); timers.at(-1)!();
  assert.deepEqual(written, ["one"]);
});
