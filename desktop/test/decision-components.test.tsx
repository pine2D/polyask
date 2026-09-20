import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import test from "node:test";
import { DecisionEditor, decisionInput, validDecisionDraft } from "../src/renderer/decision-editor";
import { registerDecisionNavigationGuard, requestDecisionNavigation } from "../src/renderer/decision-navigation";
import type { DecisionRecord } from "../src/shared/decision";
import { getCopy } from "../src/shared/copy";
import { archiveFixture } from "./fixtures";

const source = { ...archiveFixture(), results: [{ host: "example.test", label: "Answer A", text: "Exact source excerpt. More context." }] };
const saved: DecisionRecord = {
  id: "decision-1", archiveId: source.id, sourceTitle: source.task, title: "Choice", conclusion: "",
  rationale: "", uncertainties: "", nextStep: "", status: "draft", schema: 2,
  evidence: [{ resultIndex: 0, excerpt: "Exact source excerpt.", label: "Answer A", host: "example.test", capturedAt: 100 }],
  createdAt: 100, updatedAt: 100, deviceId: "device-a"
};

test("decision editor distinguishes missing, loading, and failed sources while retaining excerpts", () => {
  const copy = getCopy("en");
  const render = (record: typeof source | null | undefined, failed = false) => renderToStaticMarkup(
    <DecisionEditor copy={copy} value={decisionInput(saved)} saved={saved} source={record} sourceFailed={failed}
      editing busy={false} onChange={() => undefined} onOpenSource={() => undefined} />
  );
  assert.match(render(null), /Source result unavailable/);
  assert.match(render(null), /Exact source excerpt\./);
  assert.doesNotMatch(render(null), /Add excerpt/);
  assert.match(render(undefined), /Checking source/);
  assert.doesNotMatch(render(undefined), /Source result unavailable/);
  assert.match(render(undefined, true), /Could not load the source result/);
  assert.doesNotMatch(render(undefined, true), /Source result unavailable/);
  assert.match(render(source), /Open saved source/);
});

test("draft validation requires exact source evidence and final conclusion; Unicode limits count code points", () => {
  const input = decisionInput(saved);
  assert.equal(validDecisionDraft(input, source, saved), true);
  assert.equal(validDecisionDraft({ ...input, title: "😀".repeat(160) }, source, saved), true);
  assert.equal(validDecisionDraft({ ...input, title: "😀".repeat(161) }, source, saved), false);
  assert.equal(validDecisionDraft({ ...input, status: "final" }, source, saved), false);
  assert.equal(validDecisionDraft({ ...input, status: "final", conclusion: "Reviewed" }, source, saved), true);
  assert.equal(validDecisionDraft({ ...input, evidence: [{ resultIndex: 0, excerpt: "invented" }] }, source, saved), false);
  assert.equal(validDecisionDraft({ ...input, evidence: [input.evidence[0], input.evidence[0]] }, source, saved), false);
  assert.equal(validDecisionDraft({ ...input, evidence: [] }, source, null), true);
});

test("missing source allows retained or removed evidence, but rejects modified or new excerpts", () => {
  const input = decisionInput(saved);
  assert.equal(validDecisionDraft({ ...input, conclusion: "Updated" }, null, saved), true);
  assert.equal(validDecisionDraft({ ...input, evidence: [] }, null, saved), true);
  assert.equal(validDecisionDraft({ ...input, evidence: [{ resultIndex: 0, excerpt: "Exact" }] }, null, saved), false);
  assert.equal(validDecisionDraft(input, undefined, saved), true);
  assert.equal(validDecisionDraft(input, undefined, null), false);
});

test("global navigation waits for approval and resumes nested actions once without a second prompt", () => {
  let pending: (() => void) | undefined;
  let prompts = 0;
  let changes = 0;
  const unregister = registerDecisionNavigationGuard((action) => { pending = action; prompts++; });
  requestDecisionNavigation(() => requestDecisionNavigation(() => { changes++; }));
  assert.equal(changes, 0);
  assert.equal(prompts, 1);
  pending!();
  assert.equal(changes, 1);
  assert.equal(prompts, 1);
  unregister();
  requestDecisionNavigation(() => { changes++; });
  assert.equal(changes, 2);
});

test('decision reading prioritizes the conclusion and editing uses the shared status selector', () => {
  const copy = getCopy('en');
  const value = { ...decisionInput(saved), conclusion: 'Use the readable layout.' };
  const render = (editing: boolean) => renderToStaticMarkup(<DecisionEditor copy={copy} value={value} saved={saved} source={source} sourceFailed={false}
    editing={editing} busy={false} onChange={() => undefined} onOpenSource={() => undefined} />);
  const reading = render(false);
  assert.ok(reading.indexOf('Use the readable layout.') < reading.indexOf('class="decision-source"'));
  assert.match(render(true), /role="combobox"/);
  assert.doesNotMatch(render(true), /<select/);
});
