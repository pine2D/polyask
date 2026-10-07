import assert from "node:assert/strict";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { createRequire } from "node:module";
import { transformSync } from "esbuild";
import { getCopy } from "../src/shared/copy";
import { readSource } from "./fixtures";

// Execute the real provider with synchronous hook storage; no DOM is needed to
// check which notice survives queued React state updates.
function feedback() {
  const require = createRequire(__filename);
  const states: unknown[] = [];
  let hint = "";
  let cursor = 0;
  const module = { exports: {} as any };
  const code = transformSync(readSource("src/renderer/feedback-provider.tsx"), {
    loader: "tsx", format: "cjs", jsx: "automatic"
  }).code;
  runInNewContext(code, { module, exports: module.exports, require: (name: string) => {
    if (name === "react") return { ...require("react"),
      useState: (initial: unknown) => {
        const index = cursor++;
        if (!(index in states)) states[index] = initial;
        return [states[index], (update: any) => { states[index] = typeof update === "function" ? update(states[index]) : update; }];
      },
      useId: () => "hint-test",
      useCallback: (fn: unknown) => fn,
      useEffect: () => {}
    };
    if (name === "./control-hints") return { useControlHint: () => hint };
    if (name === "../shared/display") return { WORKSPACE_FEEDBACK_HEIGHT: 32 };
    return require(name);
  } });
  const render = () => {
    cursor = 0;
    return module.exports.FeedbackProvider({ children: null, copy: getCopy("en") });
  };
  return {
    api: () => render().props.value,
    notice: () => render().props.children[2].props.children[0].props.title,
    buttons: () => render().props.children[2].props.children.filter((node: any) => node?.type === 'button'),
    setHint: (value: string) => { hint = value; }
  };
}

test("leaving automatic focus clears its stale notice", () => {
  const h = feedback();
  const text = getCopy("en").layoutAutoFocus;
  h.api().announce(text);
  assert.equal(h.notice(), text);
  h.api().clearNotice(text);
  assert.equal(h.notice(), "");
});

test("layout recovery preserves newer operation feedback and screen-reader status", () => {
  const h = feedback();
  const text = getCopy("en").layoutAutoFocus;
  h.api().announce(text);
  h.api().announce("Broadcast complete");
  h.api().announce("Claude ready", false);
  h.api().clearNotice(text);
  assert.equal(h.notice(), "Broadcast complete");
  assert.equal(h.api().announcement, "Claude ready");
});

test("hover and focus hints cannot replace an unresolved operation notice", () => {
  const h = feedback();
  h.api().announce("Save failed. Your edits are retained.");
  h.setHint("Open another panel");
  assert.equal(h.notice(), "Save failed. Your edits are retained.");
  assert.equal(h.api().announcement, "Save failed. Your edits are retained.");
  h.setHint("");
  assert.equal(h.notice(), "Save failed. Your edits are retained.");
});

test('an operation recovery action is visible until its notice is dismissed or replaced', () => {
  const h = feedback();
  let restored = 0;
  h.api().announce('Send failed. The draft is retained.');
  h.api().setNoticeAction?.({ label: 'Return to editing', run: () => restored++ });
  const action = h.buttons().find((node: any) => node.props.children === 'Return to editing');
  assert.ok(action, 'failed operations expose their concrete recovery action');
  action.props.onClick();
  assert.equal(restored, 1);
  h.api().announce('A newer operation result');
  assert.equal(h.buttons().some((node: any) => node.props.children === 'Return to editing'), false);
  h.api().setNoticeAction?.({ label: 'Return to editing', run: () => restored++ });
  h.buttons().find((node: any) => node.props.children === getCopy('en').dismissFeedback)!.props.onClick();
  assert.equal(h.buttons().some((node: any) => node.props.children === 'Return to editing'), false);
});
