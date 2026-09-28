export type SelectionMode = "think" | "fast";

export type TierSelection =
  | { readonly requested: SelectionMode; readonly outcome: "preferred" | "alternative"; readonly observed: SelectionMode; readonly model: string }
  | { readonly requested: SelectionMode; readonly outcome: "mode_only"; readonly observed: SelectionMode }
  | { readonly requested: SelectionMode; readonly outcome: "unconfirmed" };

export type SubmissionEvidence = "message" | "composer";

// 仅作本轮显示：不进入数据库、同步或自动重发判定。
export interface SelectionMetadata {
  readonly selection?: TierSelection;
  readonly submissionEvidence?: SubmissionEvidence;
}

export function normalizeTierSelection(value: unknown): TierSelection | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const candidate = value as Record<string, unknown>;
  const requested = candidate.requested;
  if (requested !== "think" && requested !== "fast") return undefined;
  const unconfirmed: TierSelection = { requested, outcome: "unconfirmed" };
  if (candidate.observed !== requested) return unconfirmed;
  if (candidate.outcome === "mode_only") {
    return candidate.model === undefined ? { requested, outcome: "mode_only", observed: requested } : unconfirmed;
  }
  if (candidate.outcome !== "preferred" && candidate.outcome !== "alternative") return unconfirmed;
  const model = candidate.model;
  if (typeof model !== "string" || !model.trim() || model.length > 80
    || /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/u.test(model)) return unconfirmed;
  return { requested, outcome: candidate.outcome, observed: requested, model: model.trim() };
}

export function normalizeSelectionMetadata(value: unknown): SelectionMetadata {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const candidate = value as Record<string, unknown>;
  const selection = normalizeTierSelection(candidate.selection);
  const evidence = candidate.submissionEvidence;
  return {
    ...(selection ? { selection } : {}),
    ...(evidence === "message" || evidence === "composer" ? { submissionEvidence: evidence } : {})
  };
}
