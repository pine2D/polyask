import { BACKUP_PREVIEW_TTL_MS, type BackupMissingOriginals } from '../shared/backup';
import { BackupStaging, readBackupContainer, writeBackupContainer, type BackupGuard } from './backup-container';
import { backupContainerDocument, missingBackupOriginals } from './backup-export';
import { attachmentBody, validateContainerManifest } from './backup-container-manifest';
import { questionAttachmentId } from './question-attachment-repository';
import { createHash, randomUUID } from "node:crypto";
import type { BackupApplyResult, BackupDocument, BackupEntry, BackupKind, BackupPreview, BackupPreviewItem, BackupSelectionPreview } from "../shared/backup";
import { folderMembershipId } from "../shared/task-folder";
import type { DesktopDatabase } from "./database";
import { comparison, inheritBackupParticipation, isBackupPreferenceKey, projectBody, validateBackup } from "./backup-validation";
import { backupEntryKey as keyOf, activeBackupBody as active, restoredBackupId as restoredFolderId, restoredDraftId, questionRestoreSeed, planBackupRestore } from "./backup-restore-plan";
type Body = Record<string, any>;
interface Plan {
  document: BackupDocument;
  fingerprint: string;
  preview: BackupPreview;
  sealAt: number;
  lifecycle: number;
  staging?: BackupStaging;
  timer: ReturnType<typeof setTimeout>;
}
const tableKind: Record<string, BackupKind> = { questions: "question", question_answers: "questionAnswer", history: "history", archives: "archive", decisions: "decision", folders: "folder", folder_memberships: "folderMembership" };
export class BackupService {
  private readonly plans = new Map<string, Plan>();
  private intent = 0;
  private disposed = false;
  private readonly stages = new Set<BackupStaging>();
  constructor(private readonly database: DesktopDatabase, private readonly options: {
    deviceId: () => string;
    now?: () => number;
    createId?: () => string;
    stagingRoot?: string;
    previewTtlMs?: number;
  }) { }
  private now(): number { return (this.options.now ?? Date.now)(); }
  private snapshot(): Map<string, Body> {
    const snapshot = new Map(this.database.businessSnapshot().map(row => {
      const kind: BackupKind = tableKind[row.table] ?? (row.id === "workspace" ? "workspace" : row.id.startsWith("template:") ? "template" : "group");
      const id = row.table === "state_items" && kind !== "workspace" ? row.id.slice(kind.length + 1) : row.id;
      return [`${kind}:${id}`, row.body as Body];
    }));
    for (const prefix of ['preference:', 'draft:']) {
      for (const { key, value } of this.database.state.entries<Body>(prefix)) {
        if (prefix === 'preference:' && !isBackupPreferenceKey(key.slice(prefix.length))) continue;
        snapshot.set(key, value);
      }
    }
    for (const metadata of this.database.questionAttachments.all()) snapshot.set(`questionAttachments:${metadata.id}`, metadata);
    return snapshot;
  }
  private fingerprint(snapshot: Map<string, Body>): string { return createHash("sha256").update(JSON.stringify([...snapshot])).digest("hex"); }
  export(): BackupDocument {
    const entries: BackupEntry[] = [];
    for (const [key, body] of this.snapshot()) {
      if (key.startsWith("questionAttachments:") || !active(body))
        continue;
      const split = key.indexOf(":"), kind = key.slice(0, split) as BackupKind, id = key.slice(split + 1);
      if (kind === "questionAnswer" && !active(this.database.questions.get(body.questionId))) continue;
      entries.push({ kind, id, body: projectBody(kind, body, id) });
    }
    return validateBackup({ format: "polyask-backup", version: 3, exportedAt: this.now(), entries });
  }
  /** Every asynchronous continuation checks both UI intent and reset lifecycle. */
  beginOperation(): BackupGuard {
    this.invalidate();
    const intent = this.intent, lifecycle = this.database.questions.lifecycle;
    return () => {
      if (this.disposed || intent !== this.intent || lifecycle !== this.database.questions.lifecycle) throw new Error('backup_stale');
    };
  }
  invalidate(): void {
    this.intent++;
    for (const token of this.plans.keys()) this.release(token);
    for (const stage of this.stages) stage.dispose();
    this.stages.clear();
  }
  dispose(): void { this.invalidate(); this.disposed = true; }
  private release(token: string): void {
    const plan = this.plans.get(token);
    if (plan) {
      clearTimeout(plan.timer); plan.staging?.dispose();
      if (plan.staging) this.stages.delete(plan.staging);
      this.plans.delete(token);
    }
  }
  async missingOriginals(guard: BackupGuard = this.beginOperation()): Promise<BackupMissingOriginals[]> {
    guard();
    return missingBackupOriginals(this.database, this.export(), guard);
  }
  async exportFile(path: string, mode: 'complete' | 'text-only' = 'complete', guard: BackupGuard = this.beginOperation()): Promise<void> {
    guard();
    if (mode !== 'text-only' && (await this.missingOriginals(guard)).length) throw new Error('backup_images_missing');
    guard();
    const document = backupContainerDocument(this.database, this.export(), mode === 'text-only');
    const fingerprint = this.fingerprint(this.snapshot());
    const check = () => { guard(); if (this.fingerprint(this.snapshot()) !== fingerprint) throw new Error('backup_stale'); };
    let current: BackupEntry | undefined;
    const live = () => {
      guard();
      if (!current) return;
      const parent = this.database.questions.get(String(current.body.questionId));
      const metadata = this.database.questionAttachments.get(current.id);
      if (!active(parent) || !active(metadata) || metadata!.updatedAt !== current.body.updatedAt) throw new Error('backup_stale');
    };
    await writeBackupContainer(path, document, entry => {
      current = entry; live();
      return this.database.questionAttachments.readBytes(String(entry.body.questionId));
    }, live, check);
    guard();
  }
  async previewFile(path: string, guard: BackupGuard = this.beginOperation()): Promise<BackupPreview> {
    guard();
    const fingerprint = this.fingerprint(this.snapshot());
    let staging: BackupStaging | undefined;
    try {
      const result = await readBackupContainer(path, { guard, stagingRoot: this.options.stagingRoot,
        onStage: stage => { staging = stage; this.stages.add(stage); } });
      guard();
      if (this.fingerprint(this.snapshot()) !== fingerprint) throw new Error('backup_stale');
      return this.preview(result.document, result.staging);
    } catch (error) {
      staging?.dispose(); if (staging) this.stages.delete(staging);
      throw error;
    }
  }
  preview(value: unknown, staging?: BackupStaging): BackupPreview {
    for (const token of this.plans.keys()) this.release(token);
    const document = validateBackup(value), snapshot = this.snapshot();
    if (document.version === 4) {
      validateContainerManifest(value);
      if (document.entries.some(e => e.kind === 'questionAttachments') && !staging) throw new Error('backup_invalid');
    }
    const documentKeys = new Set(document.entries.map(keyOf));
    const items: BackupPreviewItem[] = document.entries.map(e => {
      const key = keyOf(e);
      let backupBody = { ...e.body } as Body;
      let local = snapshot.get(key);
      if (e.kind === 'workspace') backupBody = inheritBackupParticipation(backupBody, local && projectBody(e.kind, local));
      if (e.kind === "folderMembership") {
        const originalFolder = snapshot.get(`folder:${backupBody.folderId}`);
        if (originalFolder && !active(originalFolder) && documentKeys.has(`folder:${backupBody.folderId}`)) {
          backupBody.folderId = restoredFolderId(backupBody.folderId, originalFolder.deletedAt);
          backupBody.id = folderMembershipId({ kind: backupBody.targetKind, id: backupBody.targetId }, backupBody.folderId);
          // The actual destination may have been edited or removed after an earlier restore.
          // Keep the original tombstone intent when this destination has never existed.
          local = snapshot.get(`folderMembership:${backupBody.id}`) ?? local;
        }
      }
      let status: BackupPreviewItem['status'] = !local ? "new" : !active(local) ? "deleted" : JSON.stringify(comparison(projectBody(e.kind, local, e.id))) === JSON.stringify(comparison(backupBody)) ? "same" : "conflict";
      let originalsUnavailable = e.kind === 'questionAttachments' && status === 'same' && !this.attachmentsAvailable(String(e.body.questionId));
      if (originalsUnavailable) status = 'conflict';
      let note: BackupPreviewItem["note"];
      let blocked = false;
      let reusesIdentity = false;
      let requires: string[] = [];
      if (e.kind === 'draft') {
        const mapped = snapshot.get(`draft:${restoredDraftId(e)}`);
        note = 'draft_new_identity';
        if (mapped) {
          local = mapped;
          blocked = !active(mapped);
          reusesIdentity = active(mapped);
          status = active(mapped) ? 'same' : 'deleted';
          note = 'draft_reused';
        }
      }
      if (e.kind === "question" && questionRestoreSeed(e.id, document.entries, snapshot) !== null) {
        note = "question_new_identity";
        const mapped = snapshot.get(`question:${restoredFolderId(e.id, questionRestoreSeed(e.id, document.entries, snapshot))}`);
        blocked = !!mapped && !active(mapped);
        reusesIdentity = active(mapped);
      }
      if (e.kind === "questionAnswer" || e.kind === "questionAttachments") {
        const dependency = `question:${e.body.questionId}`;
        const hasOriginals = document.version === 4 && document.entries.some(entry => entry.kind === 'questionAttachments' && entry.body.questionId === e.body.questionId);
        const seed = hasOriginals ? questionRestoreSeed(String(e.body.questionId), document.entries, snapshot) : null;
        requires = active(snapshot.get(dependency)) && status !== "deleted" && seed === null ? [] : [dependency];
        if (e.kind === 'questionAttachments' && seed !== null) {
          const target = questionAttachmentId(restoredFolderId(String(e.body.questionId), seed));
          const mapped = snapshot.get(`questionAttachments:${target}`);
          if (mapped) {
            local = mapped;
            originalsUnavailable = active(mapped) && !this.attachmentsAvailable(mapped.questionId);
            status = active(mapped) ? originalsUnavailable ? 'conflict' : 'same' : 'deleted';
            blocked = !active(mapped);
          }
        }
        if (requires.length) note = "dependency_required";
        blocked ||= requires.length > 0 && !documentKeys.has(dependency);
      }
      if (e.kind === "folder" && status === "deleted") {
        const mapped = snapshot.get(`folder:${restoredFolderId(e.id, local!.deletedAt)}`);
        note = active(mapped) ? "folder_reused" : "folder_new_identity";
        blocked = !!mapped && !active(mapped);
      }
      if (e.kind === "folderMembership") {
        const b = e.body as Body;
        const dependencies = [`folder:${b.folderId}`, `${b.targetKind}:${b.targetId}`];
        requires = dependencies.filter(k => !active(snapshot.get(k)));
        if (requires.length)
          note = "dependency_required";
        blocked = dependencies.some(k => !active(snapshot.get(k)) && !documentKeys.has(k));
      }
      if (originalsUnavailable) note = 'originals_unavailable';
      const business = local ? active(local) ? comparison(projectBody(e.kind, local, e.id)) : { deletedAt: local.deletedAt } : null;
      const source = e.kind === "decision" ? { key: `archive:${e.body.archiveId}`, title: String(e.body.sourceTitle), available: active(snapshot.get(`archive:${e.body.archiveId}`)) } : undefined;
      return { key, kind: e.kind, id: e.id, title: String((e.kind === "questionAttachments" ? snapshot.get(`question:${e.body.questionId}`)?.text ?? document.entries.find(p => p.kind === "question" && p.id === e.body.questionId)?.body.text : undefined) ?? e.body.title ?? e.body.name ?? e.body.task ?? e.body.text ?? e.id).slice(0, 160), status, local: business, backup: comparison(backupBody), ...(note ? { note } : {}), ...(blocked ? { blocked } : {}), ...(requires.length ? { requires } : {}), ...(source ? { source } : {}), ...(reusesIdentity ? { reusesIdentity: true } : {}) };
    });
    const token = (this.options.createId ?? randomUUID)(), preview = { token, exportedAt: document.exportedAt, items, ...(document.omissions?.length ? { omissions: document.omissions } : {}) };
    const timer = setTimeout(() => this.release(token), this.options.previewTtlMs ?? BACKUP_PREVIEW_TTL_MS); timer.unref();
    this.plans.set(token, { document, fingerprint: this.fingerprint(snapshot), preview, sealAt: this.now(), lifecycle: this.database.questions.lifecycle, staging, timer });
    return structuredClone(preview);
  }
  cancel(token: string): void { this.release(token); if (token === "pending") this.invalidate(); }
  private attachmentsAvailable(questionId: string): boolean {
    try { this.database.questionAttachments.readBytes(questionId); return true; } catch { return false; }
  }
  private selectionPlan(token: string, selectedKeys: readonly string[]) {
    const plan = this.plans.get(token);
    if (!plan) throw new Error("backup_missing");
    const available = new Set(plan.preview.items.map(item => item.key));
    if (!Array.isArray(selectedKeys) || new Set(selectedKeys).size !== selectedKeys.length
      || selectedKeys.some(key => typeof key !== "string" || !available.has(key))) throw new Error("backup_selection");
    const snapshot = this.snapshot();
    if (this.database.questions.lifecycle !== plan.lifecycle || this.now() - plan.sealAt >= (this.options.previewTtlMs ?? BACKUP_PREVIEW_TTL_MS) || this.fingerprint(snapshot) !== plan.fingerprint) {
      this.release(token);
      throw new Error("backup_stale");
    }
    return planBackupRestore(plan.document.entries, snapshot, new Set(selectedKeys), { now: () => this.now(), sealAt: plan.sealAt, deviceId: this.options.deviceId, attachmentsAvailable: id => this.attachmentsAvailable(id) });
  }
  previewSelection(token: string, selectedKeys: readonly string[]): BackupSelectionPreview {
    try { return this.selectionPlan(token, selectedKeys).result; }
    catch (error) { if (this.plans.get(token)?.staging) this.release(token); throw error; }
  }
  apply(token: string, selectedKeys: readonly string[]): BackupApplyResult {
    try { return this.database.transaction(() => {
      const plan = this.selectionPlan(token, selectedKeys);
      for (const write of plan.writes) {
        if (write.kind === 'questionAttachments') {
          const stage = this.plans.get(token)?.staging;
          const entry = this.plans.get(token)?.document.entries.find(e => keyOf(e) === write.key);
          if (!stage || !entry) throw new Error('backup_missing');
          const bytes = stage.read(entry), body = attachmentBody({ ...entry, body: write.body });
          this.database.questionAttachments.put({ ...body, deviceId: write.body.deviceId,
            images: body.images.map((image, index) => ({ ...image, base64: bytes[index].toString('base64') })) });
        } else this.put(write.kind, write.id, write.body);
      }
      this.release(token);
      return { imported: plan.result.imported, skipped: plan.result.skipped };
    }); } catch (error) { if (this.plans.get(token)?.staging) this.release(token); throw error; }
  }
  private put(kind: BackupKind, id: string, body: Body): void {
    switch (kind) {
      case "question": this.database.questions.put(body as any); break;
      case "questionAnswer": this.database.questions.putAnswer(body as any, true, 0, true); break;
      case "history":
        this.database.history.put(body as any);
        break;
      case "archive":
        this.database.archives.put(body as any);
        break;
      case "decision":
        this.database.decisions.put(body as any);
        break;
      case "folder":
        this.database.folders.put(body as any);
        break;
      case "folderMembership":
        this.database.folders.putMembership(body as any);
        break;
      default: this.database.state.put(kind === "workspace" ? "workspace" : `${kind}:${id}`, body, body.updatedAt);
    }
  }
}
