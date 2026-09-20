import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FeedbackProvider } from "../src/renderer/feedback-provider";
import { getCopy } from "../src/shared/copy";
import { WORKSPACE_FEEDBACK_HEIGHT } from "../src/shared/display";
import { computeWorkspaceLayout } from "../src/main/workspace-layout";

test("every surface keeps the shared feedback and live region mounted", () => {
  for (const surface of ["sites", "commands", "archive", "settings"]) {
    const html = renderToStaticMarkup(<FeedbackProvider copy={getCopy("en")}><main>{surface}</main></FeedbackProvider>);
    assert.match(html, /aria-live="polite"/);
    assert.match(html, /class="feedback-bar"/);
    assert.match(html, new RegExp(`<main>${surface}</main>`));
  }
});

test("native site views reserve the feedback bar in either density and composer state", () => {
  for (const density of ["compact", "comfortable"] as const) for (const composerExpanded of [true, false]) {
    const layout = computeWorkspaceLayout({ width:1280,height:800,density,composerExpanded,drawerOpen:false,requestedMode:"overview",focused:"claude",overviewOrder:["claude","kimi"],focusOrder:["claude","kimi"] });
    assert.equal(layout.placements.length, 2);
    for (const {bounds} of layout.placements) assert.ok(bounds.y + bounds.height <= 800 - WORKSPACE_FEEDBACK_HEIGHT);
  }
});
