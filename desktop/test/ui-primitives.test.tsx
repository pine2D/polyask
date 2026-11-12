import assert from "node:assert/strict";
import test from "node:test";
import { SITES } from "../src/main/sites";
import { SegmentedGroup, SiteGlyph, StatusPill, SurfaceCluster } from "../src/renderer/ui-primitives";
import { readSource } from "./fixtures";
import { mountDom } from "./ui/dom-harness";

test("SiteGlyph renders nine distinct geometric marks with zero textContent pollution", async () => {
  const h = await mountDom(
    <div>
      {SITES.map((site) => (
        <span key={site.key} data-row={site.key}>
          <SiteGlyph site={site.key} />
          <span>{site.label}</span>
        </span>
      ))}
    </div>
  );
  try {
    const glyphs = [...h.document.querySelectorAll("svg.site-glyph")];
    assert.equal(glyphs.length, 9);
    const markups = new Set(glyphs.map((node) => node.innerHTML));
    assert.equal(markups.size, 9, "each of the nine AI sites has a distinct geometric mark");
    for (const site of SITES) {
      const row = h.document.querySelector(`[data-row="${site.key}"]`)!;
      const svg = row.querySelector("svg.site-glyph")!;
      assert.equal(svg.getAttribute("aria-hidden"), "true");
      assert.equal(svg.getAttribute("data-site-glyph"), site.key);
      assert.equal(row.textContent, site.label);
    }
  } finally {
    await h.close();
  }
});

test("primitive containers expose clean tonal and accessible group attributes", async () => {
  const h = await mountDom(
    <SurfaceCluster tone="sunken" data-cluster="demo">
      <SegmentedGroup label="View options">
        <button type="button" aria-pressed="true">A</button>
        <button type="button" aria-pressed="false">B</button>
      </SegmentedGroup>
      <StatusPill tone="accent">Ready</StatusPill>
    </SurfaceCluster>
  );
  try {
    const cluster = h.document.querySelector("[data-cluster='demo']")!;
    assert.equal(cluster.getAttribute("data-tone"), "sunken");
    assert.equal(cluster.classList.contains("ui-cluster"), true);
    const group = h.document.querySelector("[role='group']")!;
    assert.equal(group.getAttribute("aria-label"), "View options");
    const pill = h.document.querySelector(".ui-pill")!;
    assert.equal(pill.getAttribute("data-tone"), "accent");
    assert.equal(pill.textContent, "Ready");
  } finally {
    await h.close();
  }
});

test("CSS cascade establishes explicit token, base, primitive, and surface layers", () => {
  const theme = readSource("src/renderer/theme.css");
  const styles = readSource("src/renderer/styles.css");
  assert.match(theme, /@layer tokens, base, primitives, surfaces;/);
  assert.match(styles, /^@import "\.\/theme\.css";\r?\n@import "\.\/primitives\.css";/);
});
