import assert from "node:assert/strict";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { transformSync } from "esbuild";
import { readSource } from "./fixtures";

class HintElement extends EventTarget {
  dataset: { hint?: string } = {};
  isConnected = true;
  attributes = new Map<string, string>();
  closest() { return this.dataset.hint !== undefined ? this : null; }
  contains(value: unknown) { return value === this; }
  getAttribute(key: string) { return this.attributes.get(key) ?? null; }
  setAttribute(key: string, value: string) { this.attributes.set(key, value); }
  removeAttribute(key: string) { this.attributes.delete(key); }
}

function harness() {
  const document = Object.assign(new EventTarget(), { body: new HintElement() });
  const window = new EventTarget();
  const timers = new Set<() => void>();
  let text = "", cleanup = () => {}, mutation = () => {};
  const module = { exports: {} as { useControlHint: (id: string, sequence?: number) => string } };
  const code = transformSync(readSource("src/renderer/control-hints.ts"), { loader: "ts", format: "cjs" }).code;
  runInNewContext(code, { module, exports: module.exports, document, window, Element: HintElement, Node: HintElement,
    setTimeout: (fn: () => void) => { timers.add(fn); return fn; }, clearTimeout: (fn: () => void) => timers.delete(fn),
    MutationObserver: class { constructor(callback: () => void) { mutation = callback; } observe() {} disconnect() {} },
    require: () => ({ useState: () => [text, (value: string) => { text = value; }], useEffect: (fn: () => () => void) => { cleanup = fn(); } })
  });
  const mount = () => module.exports.useControlHint("hint");
  mount();
  return {
    text: () => text, cleanup: () => cleanup(), mutation: () => mutation(),
    reset: () => { cleanup(); mount(); },
    flush: () => { const tasks = [...timers]; timers.clear(); tasks.forEach(fn => fn()); },
    event: (type: string, element?: HintElement, extra: Record<string, unknown> = {}) => {
      const event = new Event(type);
      Object.defineProperty(event, "target", { value: element ?? document });
      Object.assign(event, extra); document.dispatchEvent(event);
    }
  };
}

test("control hints delay pointer entry, appear immediately on focus and preserve other descriptions", () => {
  const h = harness(), control = new HintElement(); control.dataset.hint = "Compare when ready";
  control.setAttribute("aria-describedby", "existing-reason");
  h.event("pointerover", control, { pointerType: "mouse" });
  assert.equal(h.text(), ""); h.flush(); assert.equal(h.text(), "Compare when ready");
  assert.equal(control.getAttribute("aria-describedby"), "existing-reason hint");
  h.event("pointerout", control, { relatedTarget: null });
  assert.equal(h.text(), ""); assert.equal(control.getAttribute("aria-describedby"), "existing-reason");
  h.event("focusin", control); assert.equal(h.text(), "Compare when ready");
  h.event("keydown", control, { key: "Escape" }); assert.equal(h.text(), "");
  assert.equal(control.getAttribute("aria-describedby"), "existing-reason"); h.cleanup();
});

test("control hints follow changing reasons and yield to a new task notice", () => {
  const h = harness(), control = new HintElement(); control.dataset.hint = "Sending";
  h.event("focusin", control); control.dataset.hint = "Ready"; h.mutation(); assert.equal(h.text(), "Ready");
  control.setAttribute("aria-describedby", "new-reason"); h.mutation();
  assert.equal(control.getAttribute("aria-describedby"), "new-reason hint");
  h.reset(); assert.equal(h.text(), ""); assert.equal(control.getAttribute("aria-describedby"), "new-reason");
  h.event("focusin", control); h.event("keydown", control, { key: "a" }); assert.equal(h.text(), "");
  h.event("focusin", control); control.isConnected = false; h.mutation(); assert.equal(h.text(), ""); h.cleanup();
});

test("touch and abandoned hover never leave a delayed hint behind", () => {
  const h = harness(), control = new HintElement(); control.dataset.hint = "History";
  h.event("pointerover", control, { pointerType: "touch" }); h.flush(); assert.equal(h.text(), "");
  h.event("pointerover", control, { pointerType: "mouse" }); h.event("click", control); h.flush(); assert.equal(h.text(), "");
  h.event("pointerover", control, { pointerType: "mouse" }); h.cleanup(); h.flush(); assert.equal(h.text(), "");
});
