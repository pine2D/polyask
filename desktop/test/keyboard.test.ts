import assert from "node:assert/strict";
import test from "node:test";

import { commandKeyAction, pageTabKeyAction } from "../src/renderer/keyboard";

test("prompt shortcuts submit or collapse outside IME composition", () => {
  assert.equal(commandKeyAction({ key: "Enter", ctrlKey: true, metaKey: false, isComposing: false }), "submit");
  assert.equal(commandKeyAction({ key: "Enter", ctrlKey: false, metaKey: true, isComposing: false }), "submit");
  assert.equal(commandKeyAction({ key: "Escape", ctrlKey: false, metaKey: false, isComposing: false }), "collapse");
  assert.equal(commandKeyAction({ key: "Enter", ctrlKey: false, metaKey: false, isComposing: false }), null);
});

test("IME composition never submits or collapses the prompt", () => {
  assert.equal(commandKeyAction({ key: "Enter", ctrlKey: true, metaKey: false, isComposing: true }), null);
  assert.equal(commandKeyAction({ key: "Escape", ctrlKey: false, metaKey: false, isComposing: true }), null);
});

test("prompt shortcut does not submit while another renderer action is locked", () => {
  assert.equal(
    commandKeyAction(
      { key: "Enter", ctrlKey: true, metaKey: false, isComposing: false },
      true
    ),
    null
  );
});

test("page tabs move focus without activating until Enter or Space", () => {
  assert.deepEqual(pageTabKeyAction("ArrowRight", 0, 2), { focus: 1, activate: false });
  assert.deepEqual(pageTabKeyAction("ArrowLeft", 0, 2), { focus: 1, activate: false });
  assert.deepEqual(pageTabKeyAction("Home", 1, 2), { focus: 0, activate: false });
  assert.deepEqual(pageTabKeyAction("End", 0, 2), { focus: 1, activate: false });
  assert.deepEqual(pageTabKeyAction("Enter", 1, 2), { focus: 1, activate: true });
  assert.deepEqual(pageTabKeyAction(" ", 0, 2), { focus: 0, activate: true });
  assert.equal(pageTabKeyAction("ArrowRight", 0, 1), null);
  assert.equal(pageTabKeyAction("Escape", 0, 2), null);
});

test("palette keys preserve native buttons and IME composition", async () => {
  const { paletteKeyAction } = await import("../src/renderer/keyboard");
  assert.equal(paletteKeyAction("Enter", false, false), null);
  assert.equal(paletteKeyAction("Enter", true, true), null);
  assert.equal(paletteKeyAction("Escape", true, true), null);
  assert.equal(paletteKeyAction("Enter", false, true), "execute");
  assert.equal(paletteKeyAction("ArrowDown", false, true), "next");
  assert.equal(paletteKeyAction("ArrowUp", false, true), "previous");
  assert.equal(paletteKeyAction("Escape", false, false), "close");
});
