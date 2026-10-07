import type { ArchiveRecord } from "../shared/archive";
import type { DecisionInput, DecisionRecord } from "../shared/decision";

export type DecisionTextField = "title" | "conclusion" | "rationale" | "uncertainties" | "nextStep";
export type DecisionField = DecisionTextField | "evidence" | `evidence-${number}`;
export type DecisionValidationCode = "title_required" | "title_too_long" | "body_too_long" |
  "final_conclusion_required" | "too_many_evidence" | "duplicate_source" | "invalid_evidence_source" |
  "excerpt_required" | "excerpt_too_long" | "excerpt_not_in_source" | "source_unavailable";
export type DecisionFieldErrors = Partial<Record<DecisionField, DecisionValidationCode>>;
export const decisionCharacterCount = (value: string): number => [...value].length;

export function validateDecisionDraft(input: DecisionInput, source: ArchiveRecord | null | undefined, saved: DecisionRecord | null): DecisionFieldErrors {
  const errors: DecisionFieldErrors = {};
  if (!input.title.trim()) errors.title = "title_required";
  else if (decisionCharacterCount(input.title) > 160) errors.title = "title_too_long";
  for (const field of ["conclusion", "rationale", "uncertainties", "nextStep"] as const) {
    if (decisionCharacterCount(input[field]) > 4000) errors[field] = "body_too_long";
  }
  if (input.status === "final" && !input.conclusion.trim()) errors.conclusion = "final_conclusion_required";
  if (input.evidence.length > 9) errors.evidence = "too_many_evidence";
  const indices = new Set<number>();
  input.evidence.forEach((item, index) => {
    const field = `evidence-${index}` as const;
    if (!Number.isInteger(item.resultIndex) || item.resultIndex < 0 || item.resultIndex > 8) errors[field] = "invalid_evidence_source";
    else if (indices.has(item.resultIndex)) errors[field] = "duplicate_source";
    else if (!item.excerpt.trim()) errors[field] = "excerpt_required";
    else if (decisionCharacterCount(item.excerpt) > 4000) errors[field] = "excerpt_too_long";
    // 来源尚未读到时只允许同一归档的原有摘录，不将未载入视为已删除或已核验。
    else if (!source || source.id !== input.archiveId) {
      if (saved?.archiveId !== input.archiveId || !saved.evidence.some(old => old.resultIndex === item.resultIndex && old.excerpt === item.excerpt)) {
        errors[field] = "source_unavailable";
      }
    } else if (!source.results[item.resultIndex]?.text?.includes(item.excerpt)) errors[field] = "excerpt_not_in_source";
    indices.add(item.resultIndex);
  });
  return errors;
}

export function validDecisionDraft(input: DecisionInput, source: ArchiveRecord | null | undefined, saved: DecisionRecord | null): boolean {
  return Object.keys(validateDecisionDraft(input, source, saved)).length === 0;
}
