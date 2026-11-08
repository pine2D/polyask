export type DecisionStatus = "draft" | "verify" | "final";
export interface DecisionEvidenceInput {
  readonly id?: string;
  readonly topic?: string;
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
  readonly sourceUpdatedAt?: number;
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
  readonly schema: 2 | 6;
}
export interface DecisionTombstone {
  readonly id: string;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly deletedAt: number;
  readonly deviceId: string;
  readonly schema: 2 | 6;
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
  if (v.sourceUpdatedAt !== undefined && !time(v.sourceUpdatedAt)) return false;
  if (!Array.isArray(v.evidence) || v.evidence.length > 36) return false;
  const ids = new Set<string>(), tuples = new Set<string>();
  const extended = v.sourceUpdatedAt !== undefined || v.evidence.some(e => e?.id !== undefined || e?.topic !== undefined);
  if (!extended && v.evidence.length > 9) return false;
  return v.evidence.every(e => {
    if (!e || typeof e !== "object" || !Number.isInteger(e.resultIndex) || e.resultIndex < 0 || e.resultIndex >= 9 ||
      !bounded(e.excerpt, 4000, true) || (e.topic !== undefined && !bounded(e.topic, 120))) return false;
    const key = extended ? evidenceTuple(e) : String(e.resultIndex);
    if (tuples.has(key) || (extended && (!bounded(e.id, 128, true) || ids.has(e.id)))) return false;
    tuples.add(key); if (e.id) ids.add(e.id);
    return true;
  }) && new TextEncoder().encode(JSON.stringify(v)).length <= 512 * 1024;
}

export function isStoredDecision(value: unknown): value is StoredDecision {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const v = value as Partial<DecisionRecord & DecisionTombstone>;
  if ((v.schema !== 2 && v.schema !== 6) || !bounded(v.id, 128, true) || !bounded(v.deviceId, 128, true) ||
    !time(v.createdAt) || !time(v.updatedAt) || v.updatedAt < v.createdAt) return false;
  if ("deletedAt" in v) return time(v.deletedAt) && v.deletedAt >= v.createdAt;
  if (!isDecisionInput(v)) return false;
  if (v.schema === 2 && (v.sourceUpdatedAt !== undefined || v.evidence?.some(e => e.id !== undefined || e.topic !== undefined))) return false;
  if (v.schema === 6 && (!time(v.sourceUpdatedAt) || !v.evidence?.every(e => bounded(e.id, 128, true)))) return false;
  return bounded(v.sourceTitle, 320) && v.evidence!.every(e =>
    bounded(e.host, 256, true) && bounded(e.label, 256) && time(e.capturedAt));
}

export function evidenceTuple(item: DecisionEvidenceInput): string {
  return JSON.stringify([item.resultIndex, item.excerpt, item.topic ?? '']);
}
export function sameEvidence(left: DecisionEvidenceInput, right: DecisionEvidenceInput): boolean {
  return left.id === right.id && evidenceTuple(left) === evidenceTuple(right);
}
