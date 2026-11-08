export type DecisionStatus = "draft" | "verify" | "final";
export interface DecisionEvidenceInput {
  readonly resultIndex: number;
  readonly excerpt: string;
}
export interface DecisionEvidence extends DecisionEvidenceInput {
  readonly host: string;
  readonly label: string;
  readonly capturedAt: number;
}
export interface DecisionInput {
  readonly archiveId: string;
  readonly title: string;
  readonly conclusion: string;
  readonly rationale: string;
  readonly uncertainties: string;
  readonly nextStep: string;
  readonly status: DecisionStatus;
  readonly evidence: readonly DecisionEvidenceInput[];
}
export interface DecisionRecord extends Omit<DecisionInput, "evidence"> {
  readonly id: string;
  readonly sourceTitle: string;
  readonly evidence: readonly DecisionEvidence[];
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly deviceId: string;
  readonly schema: 2;
}
export interface DecisionTombstone {
  readonly id: string;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly deletedAt: number;
  readonly deviceId: string;
  readonly schema: 2;
}
export type StoredDecision = DecisionRecord | DecisionTombstone;
export interface DecisionFilters {
  readonly query?: string;
  readonly status?: DecisionStatus | "";
  readonly archiveId?: string;
}

const bounded = (value: unknown, max: number, required = false): value is string =>
  typeof value === "string" && [...value].length <= max && (!required || !!value.trim());
const time = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;

export function isDecisionInput(value: unknown): value is DecisionInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const v = value as Partial<DecisionInput>;
  if (!bounded(v.archiveId, 128, true) || !bounded(v.title, 160, true) ||
    typeof v.status !== "string" || !["draft", "verify", "final"].includes(v.status) ||
    ![v.conclusion, v.rationale, v.uncertainties, v.nextStep].every(x => bounded(x, 4000)) ||
    (v.status === "final" && !v.conclusion?.trim())) return false;
  if (!Array.isArray(v.evidence) || v.evidence.length > 9) return false;
  const indices = new Set<number>();
  return v.evidence.every(e => {
    if (!e || typeof e !== "object" || !Number.isInteger(e.resultIndex) || e.resultIndex < 0 || e.resultIndex >= 9 ||
      !bounded(e.excerpt, 4000, true) || indices.has(e.resultIndex)) return false;
    indices.add(e.resultIndex);
    return true;
  });
}

export function isStoredDecision(value: unknown): value is StoredDecision {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const v = value as Partial<DecisionRecord & DecisionTombstone>;
  if (v.schema !== 2 || !bounded(v.id, 128, true) || !bounded(v.deviceId, 128, true) ||
    !time(v.createdAt) || !time(v.updatedAt) || v.updatedAt < v.createdAt) return false;
  if ("deletedAt" in v) return time(v.deletedAt) && v.deletedAt >= v.createdAt;
  return isDecisionInput(v) && bounded(v.sourceTitle, 320) && v.evidence!.every(e =>
    bounded(e.host, 256, true) && bounded(e.label, 256) && time(e.capturedAt));
}
