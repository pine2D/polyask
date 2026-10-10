import assert from "node:assert/strict";
import test from "node:test";
import React, { act } from "react";
import { FeedbackProvider, useGlobalFeedback, useIdleNotice } from "../src/renderer/feedback-provider";
import { idleFeedback } from "../src/renderer/command-bar";
import { getCopy } from "../src/shared/copy";
import { mountDom } from "./ui/dom-harness";

let announce: (text: string) => void = () => undefined;
function Announcer({ idle }: { idle?: string }) {
  announce = useGlobalFeedback().announce;
  useIdleNotice(idle ?? "");
  return null;
}
const nextFrame = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 40)); });

test("the polite live region stays mounted and re-announces repeated text after clearing (R33)", async () => {
  const h = await mountDom(<FeedbackProvider copy={getCopy("en")}><Announcer /></FeedbackProvider>);
  try {
    const region = h.document.querySelector('[aria-live="polite"]')!;
    await act(async () => announce("Broadcast complete"));
    assert.equal(region.textContent, "", "text is written on the next frame, after clearing");
    await nextFrame();
    assert.equal(region.textContent, "Broadcast complete");
    await act(async () => announce("Broadcast complete"));
    assert.equal(h.document.querySelector('[aria-live="polite"]') === region, true, "node is not remounted per announcement");
    assert.equal(region.textContent, "");
    await nextFrame();
    assert.equal(region.textContent, "Broadcast complete");
  } finally { await h.close(); }
});

test("the idle footer reflects the workspace instead of a fixed 'select sites' line (U9)", async () => {
  const copy = getCopy("zh-CN");
  const base = { copy, runState: "idle" as const, selectedCount: 9, failureCount: 0, cancelledCount: 0 };
  assert.equal(idleFeedback(base), "就绪 · 将发送到 9 个站点");
  assert.equal(idleFeedback({ ...base, selectedCount: 0 }), copy.feedbackReady);
  assert.equal(idleFeedback({ ...base, failureCount: 6, uncertainCount: 3 }), "6 个站点发送失败，可重试 · 3 个站点未确认发送：先查看页面再决定是否重试");
  assert.equal(idleFeedback({ ...base, runState: "sending" }), copy.sending);
  const h = await mountDom(<FeedbackProvider copy={copy}><Announcer idle={idleFeedback({ ...base, failureCount: 6 })} /></FeedbackProvider>);
  try {
    assert.equal(h.document.querySelector(".feedback-notice")!.textContent, "6 个站点发送失败，可重试");
    await act(async () => announce("已复制"));
    assert.equal(h.document.querySelector(".feedback-notice")!.textContent, "已复制", "operation notices still take precedence");
  } finally { await h.close(); }
});
