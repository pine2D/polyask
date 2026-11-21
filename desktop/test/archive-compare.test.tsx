import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import test from "node:test";

import { ArchiveCompare } from "../src/renderer/archive-compare";
import { compareAnswerParagraphs } from "../src/shared/archive-compare";
import { getCopy } from "../src/shared/copy";

test("answer comparison marks only exact paragraphs as shared", () => {
  const comparison = compareAnswerParagraphs(
    "Shared paragraph.\n\nLeft only.\ncontinues",
    "Shared paragraph.\n\nshared paragraph.\n\nRight only."
  );

  assert.deepEqual(comparison.left, [
    { text: "Shared paragraph.", relation: "shared" },
    { text: "Left only.\ncontinues", relation: "unique" }
  ]);
  assert.deepEqual(comparison.right, [
    { text: "Shared paragraph.", relation: "shared" },
    { text: "shared paragraph.", relation: "unique" },
    { text: "Right only.", relation: "unique" }
  ]);
});

test("answer comparison renders two explicit choices without rankings", () => {
  const copy = getCopy("zh-CN");
  const html = renderToStaticMarkup(
    <ArchiveCompare
      copy={copy}
      results={[
        { host: "claude.ai", label: "Claude", text: "共同段落\n\nClaude 内容" },
        { host: "chatgpt.com", label: "ChatGPT", text: "共同段落\n\nChatGPT 内容" },
        { host: "gemini.google.com", label: "Gemini", text: "Gemini 内容" }
      ]}
    />
  );

  assert.match(html, /逐段字面比对/);
  assert.match(html, /标出字面完全一致的段落/);
  assert.match(html, /aria-label="左栏回答"/);
  assert.match(html, /aria-label="右栏回答"/);
  assert.match(html, /完全一致/);
  assert.match(html, /仅本栏有/);
  assert.doesNotMatch(html, /评分|更好|最佳/);
});

test("difference filtering omits shared paragraphs and permits an empty result", async () => {
  const { comparisonParagraphs } = await import("../src/shared/archive-compare");
  const same = compareAnswerParagraphs("same", "same");
  assert.deepEqual(comparisonParagraphs(same.left, true), []);
  assert.deepEqual(comparisonParagraphs(same.left, false), same.left);
  const mixed = compareAnswerParagraphs("same\n\nunique", "same");
  assert.deepEqual(comparisonParagraphs(mixed.left, true), [{text:"unique",relation:"unique"}]);
});

test("comparison identifies incomplete input without hiding the captured paragraphs", () => {
  const copy = getCopy("en");
  const html = renderToStaticMarkup(<ArchiveCompare copy={copy} results={[
    { host: "claude.ai", label: "Claude", text: "Partial answer", code: "answer_truncated" },
    { host: "chatgpt.com", label: "ChatGPT", text: "Full answer" }
  ]} />);
  assert.ok(html.includes(copy.answerTruncated));
  assert.equal(html.split(copy.answerTruncated).length - 1, 1);
  assert.ok(html.indexOf(copy.answerTruncated) < html.indexOf("Partial answer"));
  assert.ok(html.includes("Full answer"));
});
