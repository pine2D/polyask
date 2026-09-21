import { isStoredQuestion, isStoredQuestionAnswer } from "../shared/question-history";
import { createHash } from "node:crypto";
import { isArchiveRecord } from "../shared/archive";
import { BACKUP_KINDS, BACKUP_MAX_BYTES, BACKUP_MAX_ENTRIES, type BackupDocument, type BackupEntry, type BackupKind } from "../shared/backup";
import { SITE_KEYS } from "../shared/contracts";
import { isStoredDecision } from "../shared/decision";
import { isStoredPromptTemplate } from "../shared/prompt-library";
import { isHistoryRecord, validSyncTime } from "../shared/sync";
import { isStoredFolderMembership, isStoredTaskFolder } from "../shared/task-folder";
type Body = Record<string, any>;
const fields: Record<BackupKind, string[]> = {
  question: ["id", "text", "sites", "requestedTier", "inputImageCount", "createdAt", "updatedAt", "schema"],
  questionAnswer: ["id", "questionId", "site", "attempt", "createdAt", "updatedAt", "schema", "submission", "submissionCode", "conversationUrl", "answerMarkdown", "capture", "captureCode", "capturedAt", "truncated", "sealedAt"],
  history: ["id", "textHash", "text", "preview", "createdAt", "lastUsedAt", "updatedAt", "schema"],
  archive: ["id", "text", "task", "source", "results", "favorite", "tags", "note", "winnerHost", "synthesis", "hosts", "resultPreviews", "searchText", "preview", "createdAt", "updatedAt", "ts", "schema"],
  decision: ["id", "archiveId", "title", "sourceTitle", "conclusion", "rationale", "uncertainties", "nextStep", "status", "evidence", "createdAt", "updatedAt", "schema"],
  folder: ["id", "name", "createdAt", "updatedAt", "schema"],
  folderMembership: ["id", "folderId", "targetKind", "targetId", "createdAt", "updatedAt", "schema"],
  template: ["id", "name", "text", "updatedAt"], group: ["id", "name", "sites", "updatedAt"], workspace: ["selectedSites", "tier", "updatedAt"]
};
const object = (v: unknown): v is Body => !!v && typeof v === "object" && !Array.isArray(v);
const pick = (v: Body, keys: string[]): Body => Object.fromEntries(keys.filter(k => Object.hasOwn(v, k)).map(k => [k, v[k]]));
const idValid = (v: unknown): v is string => typeof v === "string" && !!v.trim() && v.length <= 512;
function sites(v: unknown): boolean { return Array.isArray(v) && new Set(v).size === v.length && v.every(s => SITE_KEYS.includes(s)); }
export function projectBody(kind: BackupKind, value: unknown): Body {
  if (!object(value) || "deletedAt" in value)
    throw new Error("backup_invalid");
  const b = pick(value, fields[kind]);
  if (kind === "archive") {
    if (!Array.isArray(b.results) || !Array.isArray(b.resultPreviews))
      throw new Error("backup_invalid");
    if (b.results.some((r: unknown) => !object(r) || typeof r.host !== "string" || typeof r.label !== "string"))
      throw new Error("backup_invalid");
    b.results = b.results.map((r: Body) => object(r) ? pick(r, ["host", "label", "text", "state", "code"]) : r);
    b.resultPreviews = b.resultPreviews.map((r: Body) => object(r) ? pick(r, ["host", "label", "text"]) : r);
    if (object(b.source))
      b.source = pick(b.source, ["kind", "title", "url", "truncated", "capturedAt"]);
    if (object(b.synthesis))
      b.synthesis = pick(b.synthesis, ["host", "text", "state", "instruction", "createdAt"]);
  }
  if (kind === "decision" && Array.isArray(b.evidence))
    b.evidence = b.evidence.map((r: Body) => object(r) ? pick(r, ["resultIndex", "excerpt", "host", "label", "capturedAt"]) : r);
  const stored = { ...b, deviceId: "backup" };
  let ok = validSyncTime(b.updatedAt);
  if (kind !== "workspace")
    ok = ok && idValid(b.id);
  switch (kind) {
    case "question": ok = ok && isStoredQuestion(stored); break;
    case "questionAnswer": ok = ok && isStoredQuestionAnswer(stored); break;
    case "history":
      ok = ok && isHistoryRecord(stored) && createHash("sha256").update(b.text).digest("hex") === b.id;
      break;
    case "archive":
      ok = ok && isArchiveRecord(stored) && typeof b.preview === "string" && b.tags.every((x: unknown) => typeof x === "string");
      break;
    case "decision":
      ok = ok && isStoredDecision(stored);
      break;
    case "folder":
      ok = ok && isStoredTaskFolder(stored);
      break;
    case "folderMembership":
      ok = ok && isStoredFolderMembership(stored);
      break;
    case "template":
      ok = ok && isStoredPromptTemplate(stored);
      break;
    case "group":
      ok = ok && b.id.length <= 128 && typeof b.name === "string" && !!b.name.trim() && sites(b.sites) && b.sites.length > 0;
      break;
    case "workspace":
      ok = ok && sites(b.selectedSites) && (b.tier === null || b.tier === "fast" || b.tier === "think");
      break;
  }
  if (!ok)
    throw new Error("backup_invalid");
  return b;
}
export function validateBackup(value: unknown): BackupDocument {
  let size: number;
  try {
    size = Buffer.byteLength(JSON.stringify(value), "utf8");
  }
  catch {
    throw new Error("backup_invalid");
  }
  if (size > BACKUP_MAX_BYTES)
    throw new Error("backup_too_large");
  if (!object(value) || value.format !== "polyask-backup")
    throw new Error("backup_invalid");
  if (value.version !== 1 && value.version !== 2)
    throw new Error("backup_version");
  if (!validSyncTime(value.exportedAt) || !Array.isArray(value.entries) || value.entries.length > BACKUP_MAX_ENTRIES)
    throw new Error("backup_invalid");
  const seen = new Set<string>();
  const entries: BackupEntry[] = value.entries.map((e: unknown) => {
    if (!object(e) || !BACKUP_KINDS.includes(e.kind) || !idValid(e.id))
      throw new Error("backup_invalid");
    if (value.version === 1 && (e.kind === "question" || e.kind === "questionAnswer")) throw new Error("backup_version");
    const kind = e.kind as BackupKind, key = `${kind}:${e.id}`;
    if (seen.has(key))
      throw new Error("backup_invalid");
    seen.add(key);
    const body = projectBody(kind, e.body);
    if (kind === "workspace" ? e.id !== "workspace" : body.id !== e.id)
      throw new Error("backup_invalid");
    return { kind, id: e.id, body };
  });
  return JSON.parse(JSON.stringify({ format: "polyask-backup", version: value.version, exportedAt: value.exportedAt, entries }));
}
export function comparison(body: Readonly<Record<string, unknown>>): Body {
  return Object.fromEntries(Object.entries(body).filter(([k]) => !["deviceId", "updatedAt", "createdAt", "lastUsedAt", "ts"].includes(k)));
}
