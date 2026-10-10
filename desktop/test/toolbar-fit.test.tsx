import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { fitToolbar, moreMenuCommandIds, moreMenuGroups, toolbarFitLevel, TOOLBAR_FIT_LEVELS } from "../src/renderer/toolbar-fit";
import { TierControls } from "../src/renderer/tier-controls";
import { PageTabs } from "../src/renderer/page-tabs";
import { primarySubmissionState } from "../src/renderer/page-submission";
import { MORE_MENU_IDS } from "../src/shared/more-menu";
import { getCopy } from "../src/shared/copy";
import type { Tier } from "../src/shared/protocol";
import { mountDom } from "./ui/dom-harness";

/** Synthetic toolbar: every fit level frees `step` pixels for the prompt. */
function syntheticBar(document: Document, barWidth: number, prompt: number, step: number) {
  const bar = document.createElement("header"); bar.className = "command-bar";
  const composer = document.createElement("div"); composer.className = "prompt-composer";
  bar.append(composer); document.body.append(bar);
  bar.getBoundingClientRect = () => ({ width: barWidth }) as DOMRect;
  composer.getBoundingClientRect = () => ({ width: prompt + toolbarFitLevel(bar) * step }) as DOMRect;
  return bar;
}

test("toolbar fit picks the lowest level that keeps the prompt at least 320px wide", async () => {
  const dom = await mountDom(null);
  try {
    assert.equal(fitToolbar(syntheticBar(dom.document, 1600, 400, 50)), 0);
    const bar = syntheticBar(dom.document, 960, 200, 50);
    assert.equal(fitToolbar(bar), 3);
    assert.equal(bar.dataset.fit, "1 2 3", "levels accumulate so CSS can target `at least N`");
    const squeezed = syntheticBar(dom.document, 800, 100, 10);
    assert.equal(fitToolbar(squeezed), TOOLBAR_FIT_LEVELS - 1, "never escalates past the last level");
    const unmeasured = syntheticBar(dom.document, 0, 0, 0);
    assert.equal(fitToolbar(unmeasured), 0, "no layout (jsdom/hidden) keeps the full toolbar");
    assert.equal(unmeasured.dataset.fit, "");
  } finally { await dom.close(); }
});

test("folded toolbar entries stay reachable from the More menu", async () => {
  assert.deepEqual(moreMenuGroups(false).flat(), MORE_MENU_IDS);
  const compact = moreMenuGroups(true).flat();
  for (const id of ["open-archive", "collect-compare", "open-question-history"] as const) assert.ok(compact.includes(id), id);
  assert.ok(compact.length <= 20, "native command menu accepts at most 20 entries");
  const dom = await mountDom(null);
  try {
    const bar = syntheticBar(dom.document, 960, 200, 25);
    fitToolbar(bar);
    assert.ok(moreMenuCommandIds(dom.document).includes("open-archive"));
    bar.dataset.fit = "1 2";
    assert.equal(moreMenuCommandIds(dom.document).includes("open-archive"), false);
  } finally { await dom.close(); }
});

test("narrow tier dropdown mirrors the segmented control and changes the tier", async () => {
  const changes: Tier[] = [];
  const dom = await mountDom(<TierControls copy={getCopy("zh-CN")} tier="think" isMac={false} onChange={value => { changes.push(value); }} />);
  try {
    const select = dom.document.querySelector<HTMLSelectElement>("select.tier-select")!;
    assert.equal(select === null, false);
    assert.equal(select.value, "think");
    assert.equal(select.getAttribute("aria-label"), dom.document.querySelector(".tier-switch")!.getAttribute("aria-label"));
    assert.deepEqual([...select.options].map(option => option.textContent), ["原站", "快速", "深思"]);
    for (const value of ["site", "fast"]) {
      select.value = value;
      await import("react").then(({ act }) => act(async () => { select.dispatchEvent(new dom.window.Event("change", { bubbles: true })); }));
    }
    assert.deepEqual(changes, [null, "fast"]);
  } finally { await dom.close(); }
});

test("compact page tabs keep the most severe state with its count", () => {
  assert.equal(primarySubmissionState(["sent", "unconfirmed"]), "unconfirmed");
  assert.equal(primarySubmissionState(["sent", "failed", "unconfirmed"]), "failed");
  assert.equal(primarySubmissionState([]), null);
  const statuses = {
    claude: { site: "claude", phase: "failed", submission: { runId: "r", state: "unconfirmed" } },
    chatgpt: { site: "chatgpt", phase: "submitted", submission: { runId: "r", state: "sent" } },
    gemini: { site: "gemini", phase: "submitted", submission: { runId: "r", state: "sent" } }
  } as const;
  const html = renderToStaticMarkup(<PageTabs copy={getCopy("en")} selectedSites={["claude", "chatgpt", "gemini", "deepseek"]}
    statuses={statuses} alwaysVisible page={0} inputMethod="pointer" onPageChange={() => undefined} />);
  assert.match(html, /class="page-tab-badge unconfirmed" data-primary="true"><span>\?<\/span><span class="page-tab-count">1<\/span>/);
  assert.match(html, /class="page-tab-badge sent"><span>✓<\/span><span class="page-tab-count">2<\/span>/);
  assert.match(html, /aria-label="Page 1[^"]*2 sent[^"]*1 unconfirmed/);
});
