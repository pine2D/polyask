import type { GenerationState } from "./protocol";
import { QUESTION_ANSWER_LIMIT } from "./question-history";

export interface HistorySnapshot {
  readonly token: string;
  readonly owned: boolean;
  readonly text?: string | null;
  readonly url?: string | null;
  readonly generation?: GenerationState;
  readonly ended?: boolean;
  readonly truncated?: boolean;
}
export interface HistorySnapshotCommand {
  readonly source: "AMS";
  readonly cmd: "historySnapshot";
  readonly token: string;
  readonly deadline: number;
}
export function normalizeHistorySnapshot(value: unknown, token: string): HistorySnapshot {
  const empty: HistorySnapshot = { token, owned: false };
  if (!value || typeof value !== "object") return empty;
  const v = value as Record<string, unknown>;
  if (v.token !== token || typeof v.owned !== "boolean") return empty;
  if (!v.owned) return { ...empty, ended: v.ended === true };
  if (v.text != null && typeof v.text !== "string") return empty;
  const points = typeof v.text === "string" ? [...v.text] : [];
  return { token, owned: true, text: points.slice(0, QUESTION_ANSWER_LIMIT).join("") || null,
    url: typeof v.url === "string" && v.url.length <= 4096 ? v.url : null,
    generation: ["idle", "generating", "complete"].includes(String(v.generation)) ? v.generation as GenerationState : null,
    ended: v.ended === true, truncated: points.length > QUESTION_ANSWER_LIMIT || v.truncated === true };
}
