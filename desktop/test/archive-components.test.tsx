import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import test from "node:test";

import { ArchiveWorkspace } from "../src/renderer/archive-workspace";
import { MarkdownPreview } from "../src/renderer/markdown-preview";
import { getCopy } from "../src/shared/copy";
import { archiveFixture } from "./fixtures";

const noop = () => undefined;

type WorkspaceProps = React.ComponentProps<typeof ArchiveWorkspace> & { readonly loading: boolean };

function renderArchive(overrides: Partial<WorkspaceProps> = {}): string {
  return renderToStaticMarkup(
    <ArchiveWorkspace
      copy={getCopy("en")}
      locale="en"
      items={[]}
      selected={null}
      tags={[]}
      query=""
      favoriteOnly={false}
      selectedTag=""
      loading={false}
      busy={false}
      status=""
      onClose={noop}
      onQueryChange={noop}
      onFavoriteFilterChange={noop}
      onTagChange={noop}
      onSelect={noop}
      onCapture={noop}
      onCopy={noop}
      onExport={noop}
      onDelete={noop}
      onPatch={noop}
      onOpenSource={noop}
      pendingSynthesis={null}
      synthesisCandidate={null}
      onSynthesize={noop}
      onCollectSynthesis={noop}
      onSaveSynthesis={noop}
      {...overrides}
    />
  );
}

function occurrences(value: string, text: string): number {
  return value.split(text).length - 1;
}

test("markdown preview groups consecutive bullets and separates bullet blocks around paragraphs", () => {
  const html = renderToStaticMarkup(
    <MarkdownPreview value={"- Alpha\n- **Beta** and `code`\n\nParagraph\n\n- Gamma"} />
  );
  const firstList = html.indexOf("<ul>");
  const paragraph = html.indexOf("<p>Paragraph</p>");
  const secondList = html.indexOf("<ul>", firstList + 1);

  assert.equal(occurrences(html, "<ul>"), 2);
  assert.equal(occurrences(html, "<li>"), 3);
  assert.equal(html.includes("md-list-item"), false);
  assert.ok(firstList >= 0 && firstList < paragraph && paragraph < secondList);
  assert.ok(html.includes("<li><strong>Beta</strong> and <code>code</code></li>"));
});

test("markdown preview uses CommonMark list spacing and flushes at explicit block boundaries", () => {
  const html = renderToStaticMarkup(
    <MarkdownPreview value={[
      "- Before blank",
      "",
      "- Before paragraph",
      "",
      "Paragraph",
      "",
      "- Before heading",
      "# Heading",
      "- Before quote",
      "> Quote",
      "- Before code",
      "```",
      "- Code bullet",
      "```",
      "- At end"
    ].join("\n")} />
  );
  const expectedOrder = [
    "<ul><li><p>Before blank</p></li><li><p>Before paragraph</p></li></ul>",
    "<p>Paragraph</p>",
    "<ul><li>Before heading</li></ul>",
    "<h3>Heading</h3>",
    "<ul><li>Before quote</li></ul>",
    "<blockquote><p>Quote</p></blockquote>",
    "<ul><li>Before code</li></ul>",
    "<pre><code>- Code bullet</code></pre>",
    "<ul><li>At end</li></ul>"
  ];
  let previous = -1;

  assert.equal(occurrences(html, "<ul>"), 5);
  assert.equal(occurrences(html, "<li>"), 6);
  assert.equal(occurrences(html, "- Code bullet"), 1);
  for (const fragment of expectedOrder) {
    const position = html.indexOf(fragment);
    assert.ok(position > previous, `${fragment} should follow the previous block`);
    previous = position;
  }
});

test("archive workspace renders one loading state without empty-state copy", () => {
  const record = archiveFixture();
  const html = renderArchive({
    loading: true,
    items: [record],
    selected: record,
    detailOverride: <p>Stale detail</p>
  });

  const { JSDOM } = require('jsdom');
  const dom = new JSDOM(html);
  const listText = dom.window.document.querySelector('.archive-list')?.textContent ?? '';
  dom.window.close();
  assert.equal(occurrences(listText, "Loading results…"), 1, 'one visible list loading status; the retained organizer stays hidden');
  assert.equal(occurrences(html, "No saved results yet"), 0);
  assert.equal(occurrences(html, "No matching results"), 0);
  assert.equal(occurrences(html, "class=\"archive-empty\""), 1);
  assert.equal(occurrences(html, "Why is the sky blue?"), 0);
  assert.equal(occurrences(html, "Stale detail"), 1);
  assert.equal(occurrences(html, "class=\"archive-list\""), 1);
  assert.equal(occurrences(html, "class=\"archive-detail-pane\""), 1);
});

test("archive workspace renders one unfiltered empty state across the body", () => {
  const html = renderArchive();

  assert.equal(occurrences(html, "No saved results yet"), 1);
  assert.equal(occurrences(html, "No matching results"), 0);
  assert.equal(occurrences(html, "class=\"archive-empty\""), 1);
});

test("archive workspace renders one no-match state for any active filter", () => {
  for (const filter of [
    { query: "climate" },
    { favoriteOnly: true },
    { selectedTag: "work" }
  ]) {
    const html = renderArchive(filter);
    assert.equal(occurrences(html, "No matching results"), 1);
    assert.equal(occurrences(html, "No saved results yet"), 0);
    assert.equal(occurrences(html, "class=\"archive-empty\""), 1);
  }
});

test("archive workspace disables close while a serial action is busy", () => {
  const record = archiveFixture();
  const html = renderArchive({ busy: true, items: [record], selected: record });

  assert.match(html, /title="Close result library" aria-label="Close result library" disabled=""/);
  assert.match(html, /type="search"[^>]*disabled=""/);
  assert.match(html, /name="archive-tag-filter"[^>]*disabled=""/);
  assert.match(html, /aria-current="true" disabled=""/);
});

test("archive workspace exposes dense search, filters, actions and answer metadata", () => {
  const record = {
    ...archiveFixture(),
    favorite: true,
    tags: ["work"],
    note: "Compare later",
    winnerHost: "claude.ai",
    source: {
      kind: "page" as const,
      title: "Reference",
      url: "https://example.com/article",
      truncated: false,
      capturedAt: 900
    }
  };
  const html = renderToStaticMarkup(
    <ArchiveWorkspace
      copy={getCopy("en")}
      locale="en"
      items={[record]}
      selected={record}
      tags={["work"]}
      query="climate"
      favoriteOnly
      selectedTag="work"
      loading={false}
      busy={false}
      status=""
      onClose={noop}
      onQueryChange={noop}
      onFavoriteFilterChange={noop}
      onTagChange={noop}
      onSelect={noop}
      onCapture={noop}
      onCopy={noop}
      onExport={noop}
      onDelete={noop}
      onPatch={noop}
      onOpenSource={noop}
      pendingSynthesis={null}
      synthesisCandidate={null}
      onSynthesize={noop}
      onCollectSynthesis={noop}
      onSaveSynthesis={noop}
    />
  );

  assert.match(html, /^<section class="archive-workspace"/);
  assert.match(html, /aria-label="Result library"/);
  assert.match(html, /type="search"/);
  assert.match(html, /aria-pressed="true"/);
  assert.match(html, /aria-current="true"/);
  assert.match(html, /Capture current answers/);
  assert.match(html, /aria-label="More actions"/);
  assert.match(html, /aria-haspopup="menu"/);
  assert.equal(html.includes('13 / 4000 characters'), true);
  assert.match(html, /aria-label="Unmark best"/);
  assert.match(html, /Rayleigh scattering/);
  assert.match(html, /No answer/);
  assert.match(html, /class="archive-source"/);
  assert.match(html, /Reference/);
});

test("saved answers keep a visible truncation warning alongside their text", () => {
  for (const locale of ["en", "zh-CN", "zh-TW"]) {
    const copy = getCopy(locale);
    const record = { ...archiveFixture(), results: [
      { host: "claude.ai", label: "Claude", text: "Captured portion", code: "answer_truncated" }
    ] };
    const html = renderArchive({ copy, locale, selected: record, items: [record] });
    assert.ok(html.includes(copy.answerTruncated));
    assert.ok(html.includes("Captured portion"));
    assert.equal(occurrences(html, copy.answerTruncated), 1);
    const complete = { ...record, results: [{ ...record.results[0], code: undefined }] };
    assert.ok(!renderArchive({ copy, locale, selected: complete, items: [complete] }).includes(copy.answerTruncated));
  }
});

 test("embedded results leave the only close control to the library shell", () => {
  const html = renderArchive({ embedded: true, selected: archiveFixture() });
  assert.doesNotMatch(html, /aria-label="Close result library"/);
  assert.match(html, /aria-label="More actions"/);
});
