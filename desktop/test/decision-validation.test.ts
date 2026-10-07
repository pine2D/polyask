import assert from "node:assert/strict";
import test from "node:test";
import * as editor from "../src/renderer/decision-editor";
import { validateDecisionDraft } from "../src/renderer/decision-validation";
import type { DecisionInput, DecisionRecord } from "../src/shared/decision";
import { archiveFixture } from "./fixtures";

const source = { ...archiveFixture(), results: [{ host: "example.test", label: "Answer A", text: "Exact source excerpt. More context." }] };
const saved: DecisionRecord = {
  id: "decision-1", archiveId: source.id, sourceTitle: source.task, title: "Choice", conclusion: "",
  rationale: "", uncertainties: "", nextStep: "", status: "draft", schema: 2,
  evidence: [{ resultIndex: 0, excerpt: "Exact source excerpt.", label: "Answer A", host: "example.test", capturedAt: 100 }],
  createdAt: 100, updatedAt: 100, deviceId: "device-a"
};
const input = editor.decisionInput(saved);
const validate = (value: DecisionInput, archive: typeof source | null | undefined = source, previous: DecisionRecord | null = saved) =>
  validateDecisionDraft(value, archive, previous);

test("decision field errors accept emoji at literal 160/4000 codepoint limits and identify each overflow", () => {
  const boundary = { ...input, title: "😀".repeat(160), conclusion: "😀".repeat(4000), rationale: "😀".repeat(4000),
    uncertainties: "😀".repeat(4000), nextStep: "😀".repeat(4000) };
  assert.deepEqual(validate(boundary), {});
  assert.deepEqual(validate({ ...boundary, title: "😀".repeat(161), conclusion: "😀".repeat(4001),
    rationale: "😀".repeat(4001), uncertainties: "😀".repeat(4001), nextStep: "😀".repeat(4001) }),
  { title: "title_too_long", conclusion: "body_too_long", rationale: "body_too_long", uncertainties: "body_too_long", nextStep: "body_too_long" });
});

test("decision field errors distinguish required title and final conclusion", () => {
  assert.deepEqual(validate({ ...input, title: " \n", status: "final", conclusion: "\t " }),
    { title: "title_required", conclusion: "final_conclusion_required" });
  assert.deepEqual(validate({ ...input, status: "final", conclusion: "Reviewed" }), {});
});

test("excerpt errors require exact source text and count code points without truncating", () => {
  assert.deepEqual(validate({ ...input, evidence: [{ resultIndex: 0, excerpt: "" }] }), { "evidence-0": "excerpt_required" });
  assert.deepEqual(validate({ ...input, evidence: [{ resultIndex: 0, excerpt: "Exact  source excerpt." }] }), { "evidence-0": "excerpt_not_in_source" });
  const emojiSource = { ...source, results: [{ ...source.results[0], text: "😀".repeat(4001) }] };
  assert.deepEqual(validate({ ...input, evidence: [{ resultIndex: 0, excerpt: "😀".repeat(4000) }] }, emojiSource), {});
  assert.deepEqual(validate({ ...input, evidence: [{ resultIndex: 0, excerpt: "😀".repeat(4001) }] }, emojiSource), { "evidence-0": "excerpt_too_long" });
});

test("evidence errors identify repeated or invalid sources and the ninth excerpt limit", () => {
  assert.deepEqual(validate({ ...input, evidence: [input.evidence[0], input.evidence[0]] }), { "evidence-1": "duplicate_source" });
  assert.deepEqual(validate({ ...input, evidence: [{ resultIndex: -1, excerpt: "Exact" }] }), { "evidence-0": "invalid_evidence_source" });
  const nineSource = { ...source, results: Array.from({ length: 9 }, (_, index) => ({ host: "example.test", label: `Answer ${index}`, text: "Exact" })) };
  const nine = Array.from({ length: 9 }, (_, resultIndex) => ({ resultIndex, excerpt: "Exact" }));
  assert.deepEqual(validate({ ...input, evidence: nine }, nineSource), {});
  assert.deepEqual(validate({ ...input, evidence: [...nine, nine[0]] }, nineSource), { evidence: "too_many_evidence", "evidence-9": "duplicate_source" });
});

test("missing and unloaded sources accept only saved excerpts from the same archive", () => {
  for (const unavailable of [null, undefined]) {
    assert.deepEqual(validateDecisionDraft({ ...input, rationale: "Edited" }, unavailable, saved), {});
    assert.deepEqual(validateDecisionDraft({ ...input, evidence: [] }, unavailable, saved), {});
    assert.deepEqual(validateDecisionDraft({ ...input, evidence: [{ resultIndex: 0, excerpt: "Exact" }] }, unavailable, saved), { "evidence-0": "source_unavailable" });
    assert.deepEqual(validateDecisionDraft(input, unavailable, null), { "evidence-0": "source_unavailable" });
    assert.deepEqual(validateDecisionDraft({ ...input, archiveId: "other-source" }, unavailable, saved), { "evidence-0": "source_unavailable" });
    assert.equal(editor.validDecisionDraft({ ...input, archiveId: "other-source" }, unavailable, saved), false);
  }
});
