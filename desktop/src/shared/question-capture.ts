import type { SiteKey } from "./contracts";
import type { GenerationState } from "./protocol";
import { QUESTION_ANSWER_LIMIT } from "./question-history";

// 本轮归属用的是哪一级定位（site-runtime history-adapters.js ① / history-locate.js ②③）。
// 只做诊断记账：主进程内存计数 → 诊断报告白名单行；不持久化、不进 SITE_CODES、不产用户可见文案。
export const CAPTURE_LOCATES = ["selector", "semantic", "anchor"] as const;
export type CaptureLocate = typeof CAPTURE_LOCATES[number];
export function isCaptureLocate(value: unknown): value is CaptureLocate {
  return CAPTURE_LOCATES.includes(value as CaptureLocate);
}
export type CaptureLocateCounts = Partial<Record<SiteKey, Partial<Record<CaptureLocate, number>>>>;

export interface HistorySnapshot {
  readonly token: string;
  readonly owned: boolean;
  readonly text?: string | null;
  readonly url?: string | null;
  readonly generation?: GenerationState;
  readonly ended?: boolean;
  readonly truncated?: boolean;
  readonly locate?: CaptureLocate;
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
  if (!v.owned) return { ...empty, ended: v.ended === true,
    generation: v.ended !== true && v.generation === "generating" ? "generating" : null };
  if (v.text != null && typeof v.text !== "string") return empty;
  const points = typeof v.text === "string" ? [...v.text] : [];
  return { token, owned: true, text: points.slice(0, QUESTION_ANSWER_LIMIT).join("") || null,
    url: typeof v.url === "string" && v.url.length <= 4096 ? v.url : null,
    generation: ["idle", "generating", "complete"].includes(String(v.generation)) ? v.generation as GenerationState : null,
    ended: v.ended === true, truncated: points.length > QUESTION_ANSWER_LIMIT || v.truncated === true,
    ...(isCaptureLocate(v.locate) ? { locate: v.locate } : {}) };
}
