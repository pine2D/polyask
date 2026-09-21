import { SITE_KEYS, type SiteKey } from "./contracts";
import { MAX_IMAGE_COUNT } from "./images";
import type { Tier } from "./protocol";
import { validSyncTime } from "./sync";

export const QUESTION_SCHEMA = 4;
export const QUESTION_ANSWER_LIMIT = 200_000;
export interface QuestionVersion {
  readonly schema: 4;
  readonly id: string;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly deviceId: string;
}
export interface QuestionRecord extends QuestionVersion {
  readonly text: string;
  readonly sites: readonly SiteKey[];
  readonly requestedTier: Tier;
  readonly inputImageCount: number;
}
export interface QuestionTombstone extends QuestionVersion { readonly deletedAt: number }
export type SubmissionState = "pending" | "submitted" | "failed" | "unconfirmed" | "cancelled";
export type CaptureState = "waiting" | "partial" | "complete" | "unknown" | "unavailable" | "interrupted";
export interface QuestionAnswerIdentity extends QuestionVersion {
  readonly questionId: string;
  readonly site: SiteKey;
  readonly attempt: number;
}
export interface QuestionAnswerRecord extends QuestionAnswerIdentity {
  readonly submission: SubmissionState;
  readonly submissionCode: string | null;
  readonly conversationUrl: string | null;
  readonly answerMarkdown: string | null;
  readonly capture: CaptureState;
  readonly captureCode: string | null;
  readonly capturedAt: number | null;
  readonly truncated: boolean;
  readonly sealedAt: number | null;
}
export interface QuestionAnswerTombstone extends QuestionAnswerIdentity { readonly deletedAt: number }
export type StoredQuestion = QuestionRecord | QuestionTombstone;
export type StoredQuestionAnswer = QuestionAnswerRecord | QuestionAnswerTombstone;
export interface QuestionSummary extends QuestionRecord {
  readonly savedSites: number;
  readonly answers: readonly Omit<QuestionAnswerRecord, "answerMarkdown">[];
}
export interface QuestionFilters { readonly query?: string; readonly cursor?: string; readonly limit?: number }
export interface QuestionPage { readonly items: readonly QuestionSummary[]; readonly cursor: string | null }
export interface QuestionDetail { readonly question: QuestionRecord; readonly answers: readonly QuestionAnswerRecord[] }

const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
export const questionIdValid = (v: unknown): v is string => typeof v === "string" && !!v.trim() && v.length <= 128 && !/[\x00-\x1f\x7f]/.test(v);
function version(v: Record<string, unknown>): boolean {
  return v.schema === QUESTION_SCHEMA && questionIdValid(v.id) && questionIdValid(v.deviceId) &&
    validSyncTime(v.createdAt) && validSyncTime(v.updatedAt) && v.updatedAt >= v.createdAt;
}
export function isStoredQuestion(v: unknown): v is StoredQuestion {
  if (!object(v) || !version(v)) return false;
  if ("deletedAt" in v) return validSyncTime(v.deletedAt) && v.deletedAt >= Number(v.createdAt);
  return typeof v.text === "string" && !!v.text.trim() && v.text.length <= 100_000 &&
    Array.isArray(v.sites) && v.sites.length > 0 && v.sites.length <= SITE_KEYS.length &&
    new Set(v.sites).size === v.sites.length && v.sites.every(site => SITE_KEYS.includes(site)) &&
    (v.requestedTier === null || v.requestedTier === "fast" || v.requestedTier === "think") &&
    Number.isInteger(v.inputImageCount) && Number(v.inputImageCount) >= 0 && Number(v.inputImageCount) <= MAX_IMAGE_COUNT;
}
const code = (v: unknown) => v === null || (typeof v === "string" && /^[a-z][a-z0-9_]{0,63}$/.test(v));
export function isStoredQuestionAnswer(v: unknown): v is StoredQuestionAnswer {
  if (!object(v) || !version(v) || !questionIdValid(v.questionId) || !SITE_KEYS.includes(v.site as SiteKey) ||
    !Number.isSafeInteger(v.attempt) || Number(v.attempt) < 1) return false;
  if ("deletedAt" in v) return validSyncTime(v.deletedAt) && v.deletedAt >= Number(v.createdAt);
  if (!["pending", "submitted", "failed", "unconfirmed", "cancelled"].includes(String(v.submission)) ||
    !["waiting", "partial", "complete", "unknown", "unavailable", "interrupted"].includes(String(v.capture)) ||
    !code(v.submissionCode) || !code(v.captureCode) || typeof v.truncated !== "boolean") return false;
  if (v.answerMarkdown !== null && (typeof v.answerMarkdown !== "string" || !v.answerMarkdown.trim() || [...v.answerMarkdown].length > QUESTION_ANSWER_LIMIT)) return false;
  if (v.conversationUrl !== null && (typeof v.conversationUrl !== "string" || v.conversationUrl.length > 4096)) return false;
  if (v.capturedAt !== null && (!validSyncTime(v.capturedAt) || v.capturedAt < Number(v.createdAt))) return false;
  if (v.sealedAt !== null && (!validSyncTime(v.sealedAt) || v.sealedAt < Number(v.createdAt))) return false;
  if (v.answerMarkdown !== null && v.capturedAt === null) return false;
  return v.capture !== "complete" || (v.answerMarkdown !== null && !v.truncated && v.sealedAt !== null);
}
