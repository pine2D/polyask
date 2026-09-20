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

test("an intentional overview falls back to focus when reserved space is too small", () => {
  const layout = computeWorkspaceLayout({ width:800,height:450,density:"compact",composerExpanded:false,drawerOpen:false,requestedMode:"overview",focused:"claude",overviewOrder:["claude","kimi","chatgpt","gemini"],focusOrder:["claude","kimi","chatgpt","gemini"] });
  assert.equal(layout.mode, "focus");
});

test("page tabs name the sites in their tooltip and accessible label", async () => {
  const { PageTabs } = await import("../src/renderer/page-tabs");
  const { SITES } = await import("../src/main/sites");
  const html = renderToStaticMarkup(<PageTabs copy={getCopy("en")} sites={SITES} selectedSites={SITES.map((site) => site.key)} statuses={{}} page={0} inputMethod="pointer" onPageChange={() => {}} />);
  assert.match(html, /title="Claude · ChatGPT · Gemini \(Alt\+1\)"/);
  assert.match(html, /aria-label="[^"]*Claude · ChatGPT · Gemini"/);
});

test("comparison and More share one toolbar grid cell", async () => {
  const { WorkspaceActions } = await import("../src/renderer/workspace-actions");
  const props = { copy:getCopy("en"),disabled:false,failureCount:0,cancelledCount:0,synthesisPending:false,syncStatus:{state:"idle",connected:false,pending:0,errorCount:0,readOnly:false,oauthConfigured:false,secureTokenStorage:true},onOpenMore:()=>{},onCompare:()=>{} };
  const html = renderToStaticMarkup(React.createElement(WorkspaceActions as React.ComponentType<any>,props));
  assert.match(html, /^<div class="workspace-actions priority-p0"><button[^>]*class="compare-trigger"/);
  assert.match(html, /aria-label="Capture and compare"/);
  assert.match(html, /aria-label="More actions"/);
});
