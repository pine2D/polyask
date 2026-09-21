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
      useCallback: (fn: unknown) => fn,
      useEffect: () => {}
    };
    if (name === "../shared/display") return { WORKSPACE_FEEDBACK_HEIGHT: 32 };
    return require(name);
  } });
  const render = () => {
    cursor = 0;
    return module.exports.FeedbackProvider({ children: null, copy: getCopy("en") });
  };
  return {
    api: () => render().props.value,
    notice: () => render().props.children[2].props.children[0].props.title
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
