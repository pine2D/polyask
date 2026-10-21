import type { StoredQuestion, StoredQuestionAnswer } from "../shared/question-history";
import { createHash } from "node:crypto";
import type { StoredArchive } from "../shared/archive";
import type { StoredDecision } from "../shared/decision";
import type { StoredTaskFolder, StoredFolderMembership } from "../shared/task-folder";
import type { StoredQuestionAttachments } from '../shared/question-attachments';
import { utf8Preview, type OutboxOperation, type StateFragment, type StoredHistory } from '../shared/sync';
import type { DriveFile } from './drive-client';
import type { SyncDrive } from './sync-engine';
import type { SyncRepository } from './sync-repository';
type QueuedOperation = OutboxOperation & { readonly revision: number };
export async function uploadSyncOperation(repository: SyncRepository, drive: SyncDrive, now: () => number, operation: QueuedOperation, signal: AbortSignal, current: () => boolean = () => true): Promise<void> {
  const deviceId = repository.deviceId();
  let key = operation.key;
  let name: string;
  let properties: Record<string, string>;
  let body: StoredQuestionAttachments | StoredQuestion | StoredQuestionAnswer | StateFragment | StoredHistory | StoredArchive | StoredDecision | StoredTaskFolder | StoredFolderMembership;
  if (operation.kind === "questionAttachments" && operation.entityId) {
    if (!repository.imageOperationEligible(operation)) return;
    let record: StoredQuestionAttachments | null;
    try { record = repository.questionAttachments(operation.entityId); }
    catch { throw Object.assign(new Error("request_failed"), { code: "request_failed" }); }
    if (!record) return;
    key = `questionAttachments:${record.id}`;
    const wireId = createHash("sha256").update(record.id).digest("hex");
    name = `questionAttachments-${wireId}.json`;
    properties = { app: "polyask", schema: "5", kind: operation.kind, id: wireId, deleted: "deletedAt" in record ? "1" : "0" };
    body = record;
  } else if (operation.kind === "state") {
    key = `state:${deviceId}`;
    name = `state-${deviceId}.json`;
    properties = { app: "polyask", schema: "1", kind: "state", id: deviceId };
    body = repository.localStateFragment();
  } else if (operation.kind === "history" && operation.entityId) {
    const record = repository.history(operation.entityId);
    if (!record) { repository.complete(operation.key, operation.revision); return; }
    name = `history-${record.textHash}-${deviceId}.json`;
    properties = { app: "polyask", schema: "1", kind: "history", id: record.textHash, device: deviceId, deleted: "deletedAt" in record ? "1" : "0", preview: "deletedAt" in record ? "" : utf8Preview(record.text) };
    body = { ...record, deviceId };
  } else if (operation.kind === "archive" && operation.entityId) {
    const record = repository.archive(operation.entityId);
    if (!record) { repository.complete(operation.key, operation.revision); return; }
    name = `archive-${record.id}.json`;
    properties = { app: "polyask", schema: "1", kind: "archive", id: record.id, deleted: "deletedAt" in record ? "1" : "0", preview: "deletedAt" in record ? "" : utf8Preview(record.text) };
    body = record;
  } else if (operation.kind === "decision" && operation.entityId) {
    const record = repository.decision(operation.entityId);
    if (!record) { repository.complete(operation.key, operation.revision); return; }
    key = `decision:${record.id}`;
    name = `decision-${record.id}.json`;
    properties = { app: "polyask", schema: "2", kind: "decision", id: record.id, deleted: "deletedAt" in record ? "1" : "0" };
    body = record;
  } else if ((operation.kind === "question" || operation.kind === "questionAnswer") && operation.entityId) {
    const record = operation.kind === "question" ? repository.question(operation.entityId) : repository.questionAnswer(operation.entityId);
    if (!record) { repository.complete(operation.key, operation.revision); return; }
    key = `${operation.kind}:${record.id}`;
    const wireId = createHash("sha256").update(record.id).digest("hex");
    name = `${operation.kind}-${wireId}.json`;
    properties = { app: "polyask", schema: "4", kind: operation.kind, id: wireId, deleted: "deletedAt" in record ? "1" : "0" };
    body = record;
  } else if ((operation.kind === "folder" || operation.kind === "folderMembership") && operation.entityId) {
    const record = operation.kind === "folder" ? repository.folder(operation.entityId) : repository.folderMembership(operation.entityId);
    if (!record) { repository.complete(operation.key, operation.revision); return; }
    key = `${operation.kind}:${record.id}`;
    const wireId = createHash("sha256").update(record.id).digest("hex");
    name = `${operation.kind}-${wireId}.json`;
    properties = { app: "polyask", schema: "3", kind: operation.kind, id: wireId, deleted: "deletedAt" in record ? "1" : "0" };
    body = record;
  } else { repository.complete(operation.key, operation.revision); return; }
  const lifecycle = repository.imageLifecycle();
  const existing = repository.findDriveFile(key) ?? (operation.kind === "questionAttachments"
    ? repository.driveFiles().find(file => file.appProperties?.kind === "questionAttachments" && file.appProperties.id === properties.id) : null);
  let saved: DriveFile;
  try {
    saved = await drive.upsert(existing?.id ?? null, name, properties, body, signal);
  } catch (error) {
    if (!existing || (error as { code?: string }).code !== "not_found") throw error;
    // Another device converged this duplicate away: write to the surviving copy, or create one.
    signal.throwIfAborted();
    if (!current() || lifecycle !== repository.imageLifecycle()) return;
    repository.deleteDriveFile(existing.id);
    saved = await drive.upsert(repository.findDriveFile(key)?.id ?? null, name, properties, body, signal);
  }
  signal.throwIfAborted();
  if (!saved.id) throw Object.assign(new Error("invalid_response"), { code: "invalid_response" });
  if (!current() || lifecycle !== repository.imageLifecycle()) return;
  repository.putDriveFile(saved, key, now());
  repository.complete(operation.key, operation.revision);
}
