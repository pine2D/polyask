import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import test from "node:test";
import { SiteFrames } from "../src/renderer/site-frames";
import { SITES } from "../src/main/sites";
import { getCopy } from "../src/shared/copy";
import type { SiteStatus } from "../src/shared/protocol";

const site = SITES[0]!;
const noop = () => undefined;
function render(status?: SiteStatus) {
  return renderToStaticMarkup(<SiteFrames copy={getCopy("en")} sites={[site]}
    statuses={status ? { [site.key]: status } : {}} selected={new Set([site.key])}
    layout={{ mode: "overview", focused: site.key, page: 0, pageCount: 1,
      placements: [{ key: site.key, bounds: { x: 0, y: 0, width: 380, height: 500 } }] }}
    history={{ [site.key]: { back: true, forward: false } }}
    onToggle={noop} onFocus={noop} onReload={noop} onBack={noop} />);
}

test("initial and explicit loading expose named indeterminate progress", () => {
  for (const status of [undefined, { site: site.key, phase: "loading" as const }]) {
    const html = render(status);
    assert.match(html, /role="progressbar" aria-label="Claude · Loading"/);
    assert.doesNotMatch(html, /aria-valuenow/);
    assert.match(html, /class="site-state priority-p0"[^>]*>Loading</);
  }
});

test("loading progress ends on ready, failure and every command phase", () => {
  for (const phase of ["ready", "failed", "crashed", "sending", "submitted", "generating", "complete", "warning", "cancelled"] as const) {
    const html = render({ site: site.key, phase });
    assert.doesNotMatch(html, /role="progressbar"/);
    assert.doesNotMatch(html, />Loading</);
    assert.match(html, /aria-label="Reload Claude"/);
  }
});

test("tile headers echo confirmed model or tier badges, site glyphs, and amber uncertain markers", () => {
  const withModel = render({
    site: site.key,
    phase: "generating",
    selection: { requested: "think", outcome: "preferred", observed: "think", model: "Claude 3.7 Sonnet" }
  });
  assert.match(withModel, /data-site-glyph="claude"/);
  assert.match(withModel, /class="site-model-badge priority-p1"[^>]*data-tier-mode="think"[^>]*aria-hidden="true">Claude 3\.7 Sonnet<\/span>/);
  assert.doesNotMatch(withModel, /data-uncertain="true"/);

  const modeOnly = render({
    site: site.key,
    phase: "submitted",
    selection: { requested: "fast", outcome: "mode_only", observed: "fast" }
  });
  assert.match(modeOnly, /class="site-model-badge priority-p1"[^>]*data-tier-mode="fast"[^>]*>Fast<\/span>/);

  const unconfirmedTier = render({
    site: site.key,
    phase: "warning",
    code: "tier_unconfirmed",
    selection: { requested: "think", outcome: "unconfirmed" }
  });
  assert.doesNotMatch(unconfirmedTier, /class="site-model-badge/);

  const unconfirmedSubmit = render({
    site: site.key,
    phase: "failed",
    code: "submit_unconfirmed"
  });
  assert.match(unconfirmedSubmit, /<article class="tile-frame phase-failed" data-uncertain="true"/);
});
