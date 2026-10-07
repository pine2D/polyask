import { createHash, randomUUID } from "node:crypto";
import type { BackupApplyResult, BackupDocument, BackupEntry, BackupKind, BackupPreview, BackupPreviewItem, BackupSelectionPreview } from "../shared/backup";
import { folderMembershipId } from "../shared/task-folder";
import type { DesktopDatabase } from "./database";
import { comparison, projectBody, validateBackup } from "./backup-validation";
import { backupEntryKey as keyOf, activeBackupBody as active, restoredBackupId as restoredFolderId, questionRestoreSeed, planBackupRestore } from "./backup-restore-plan";
type Body = Record<string, any>;
interface Plan {
  document: BackupDocument;
  fingerprint: string;
  preview: BackupPreview;
  sealAt: number;
}
const tableKind: Record<string, BackupKind> = { questions: "question", question_answers: "questionAnswer", history: "history", archives: "archive", decisions: "decision", folders: "folder", folder_memberships: "folderMembership" };
export class BackupService {
  private readonly plans = new Map<string, Plan>();
  constructor(private readonly database: DesktopDatabase, private readonly options: {
    deviceId: () => string;
    now?: () => number;
    createId?: () => string;
  }) { }
  private now(): number { return (this.options.now ?? Date.now)(); }
  private snapshot(): Map<string, Body> {
    return new Map(this.database.businessSnapshot().map(row => {
      const kind: BackupKind = tableKind[row.table] ?? (row.id === "workspace" ? "workspace" : row.id.startsWith("template:") ? "template" : "group");
      const id = row.table === "state_items" && kind !== "workspace" ? row.id.slice(kind.length + 1) : row.id;
      return [`${kind}:${id}`, row.body as Body];
    }));
  }
  private fingerprint(snapshot: Map<string, Body>): string { return createHash("sha256").update(JSON.stringify([...snapshot])).digest("hex"); }
  export(): BackupDocument {
    const entries: BackupEntry[] = [];
    for (const [key, body] of this.snapshot()) {
      if (!active(body))
        continue;
      const split = key.indexOf(":"), kind = key.slice(0, split) as BackupKind, id = key.slice(split + 1);
      if (kind === "questionAnswer" && !active(this.database.questions.get(body.questionId))) continue;
      entries.push({ kind, id, body: projectBody(kind, body) });
    }
    return validateBackup({ format: "polyask-backup", version: 2, exportedAt: this.now(), entries });
  }
  preview(value: unknown): BackupPreview {
    const document = validateBackup(value), snapshot = this.snapshot();
    const documentKeys = new Set(document.entries.map(keyOf));
    const items: BackupPreviewItem[] = document.entries.map(e => {
      const key = keyOf(e);
      const backupBody = { ...e.body } as Body;
      let local = snapshot.get(key);
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
      const status = !local ? "new" : !active(local) ? "deleted" : JSON.stringify(comparison(projectBody(e.kind, local))) === JSON.stringify(comparison(backupBody)) ? "same" : "conflict";
      let note: BackupPreviewItem["note"];
      let blocked = false;
      let reusesIdentity = false;
      let requires: string[] = [];
      if (e.kind === "question" && questionRestoreSeed(e.id, document.entries, snapshot) !== null) {
        note = "question_new_identity";
        const mapped = snapshot.get(`question:${restoredFolderId(e.id, questionRestoreSeed(e.id, document.entries, snapshot))}`);
        blocked = !!mapped && !active(mapped);
        reusesIdentity = active(mapped);
      }
      if (e.kind === "questionAnswer") {
        const dependency = `question:${e.body.questionId}`;
        requires = active(snapshot.get(dependency)) && status !== "deleted" ? [] : [dependency];
        if (requires.length) note = "dependency_required";
        blocked = requires.length > 0 && !documentKeys.has(dependency);
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
      const business = local ? active(local) ? comparison(projectBody(e.kind, local)) : { deletedAt: local.deletedAt } : null;
      const source = e.kind === "decision" ? { key: `archive:${e.body.archiveId}`, title: String(e.body.sourceTitle), available: active(snapshot.get(`archive:${e.body.archiveId}`)) } : undefined;
      return { key, kind: e.kind, id: e.id, title: String(e.body.title ?? e.body.name ?? e.body.task ?? e.body.text ?? e.id).slice(0, 160), status, local: business, backup: comparison(backupBody), ...(note ? { note } : {}), ...(blocked ? { blocked } : {}), ...(requires.length ? { requires } : {}), ...(source ? { source } : {}), ...(reusesIdentity ? { reusesIdentity: true } : {}) };
    });
    const token = (this.options.createId ?? randomUUID)(), preview = { token, exportedAt: document.exportedAt, items };
    this.plans.clear();
    this.plans.set(token, { document, fingerprint: this.fingerprint(snapshot), preview, sealAt: this.now() });
    return structuredClone(preview);
  }
  cancel(token: string): void { this.plans.delete(token); }
  private selectionPlan(token: string, selectedKeys: readonly string[]) {
    const plan = this.plans.get(token);
    if (!plan) throw new Error("backup_missing");
    const available = new Set(plan.preview.items.map(item => item.key));
    if (!Array.isArray(selectedKeys) || new Set(selectedKeys).size !== selectedKeys.length
      || selectedKeys.some(key => typeof key !== "string" || !available.has(key))) throw new Error("backup_selection");
    const snapshot = this.snapshot();
    if (this.fingerprint(snapshot) !== plan.fingerprint) {
      this.plans.delete(token);
      throw new Error("backup_stale");
    }
    return planBackupRestore(plan.document.entries, snapshot, new Set(selectedKeys), { now: () => this.now(), sealAt: plan.sealAt, deviceId: this.options.deviceId });
  }
  previewSelection(token: string, selectedKeys: readonly string[]): BackupSelectionPreview {
    return this.selectionPlan(token, selectedKeys).result;
  }
  apply(token: string, selectedKeys: readonly string[]): BackupApplyResult {
    return this.database.transaction(() => {
      const plan = this.selectionPlan(token, selectedKeys);
      for (const write of plan.writes) this.put(write.kind, write.id, write.body);
      this.plans.delete(token);
      return { imported: plan.result.imported, skipped: plan.result.skipped };
    });
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
