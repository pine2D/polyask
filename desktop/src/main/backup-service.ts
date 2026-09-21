import { questionAnswerId } from "./question-repository";
import { createHash, randomUUID } from "node:crypto";
import type { BackupApplyResult, BackupDocument, BackupEntry, BackupKind, BackupPreview, BackupPreviewItem } from "../shared/backup";
import { folderMembershipId } from "../shared/task-folder";
import type { DesktopDatabase } from "./database";
import { comparison, projectBody, validateBackup } from "./backup-validation";
type Body = Record<string, any>;
interface Plan {
  document: BackupDocument;
  fingerprint: string;
  preview: BackupPreview;
}
const keyOf = (entry: Pick<BackupEntry, "kind" | "id">) => `${entry.kind}:${entry.id}`;
const active = (body: Body | null | undefined) => !!body && !("deletedAt" in body);
const restoredFolderId = (id: string, deletedAt: unknown) => `restore-${createHash("sha256").update(JSON.stringify([id, deletedAt])).digest("hex").slice(0, 40)}`;
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
  private questionRestoreSeed(id: string, entries: readonly BackupEntry[], snapshot: Map<string, Body>): unknown {
    const parent = snapshot.get(`question:${id}`);
    if (parent && !active(parent)) return parent.deletedAt;
    const deleted = entries.filter(e => e.kind === "questionAnswer" && e.body.questionId === id)
      .map(e => snapshot.get(keyOf(e))).filter(body => body && !active(body));
    return deleted.length ? deleted.map(body => [body!.id, body!.deletedAt]).sort().flat() : null;
  }
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
      let requires: string[] = [];
      if (e.kind === "question" && this.questionRestoreSeed(e.id, document.entries, snapshot) !== null) {
        note = "question_new_identity";
        const mapped = snapshot.get(`question:${restoredFolderId(e.id, this.questionRestoreSeed(e.id, document.entries, snapshot))}`);
        blocked = !!mapped && !active(mapped);
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
      return { key, kind: e.kind, id: e.id, title: String(e.body.title ?? e.body.name ?? e.body.task ?? e.body.text ?? e.id).slice(0, 160), status, local: business, backup: comparison(backupBody), ...(note ? { note } : {}), ...(blocked ? { blocked } : {}), ...(requires.length ? { requires } : {}) };
    });
    const token = (this.options.createId ?? randomUUID)(), preview = { token, exportedAt: document.exportedAt, items };
    this.plans.clear();
    this.plans.set(token, { document, fingerprint: this.fingerprint(snapshot), preview });
    return structuredClone(preview);
  }
  cancel(token: string): void { this.plans.delete(token); }
  apply(token: string, selectedKeys: readonly string[]): BackupApplyResult {
    const plan = this.plans.get(token);
    if (!plan)
      throw new Error("backup_missing");
    const availableKeys = new Set(plan.preview.items.map(i => i.key));
    if (!Array.isArray(selectedKeys) || new Set(selectedKeys).size !== selectedKeys.length || selectedKeys.some(k => typeof k !== "string" || !availableKeys.has(k)))
      throw new Error("backup_selection");
    return this.database.transaction(() => {
      const snapshot = this.snapshot();
      if (this.fingerprint(snapshot) !== plan.fingerprint) {
        this.plans.delete(token);
        throw new Error("backup_stale");
      }
      const selected = new Set(selectedKeys), folderMap = new Map<string, string>(), questionMap = new Map<string, string>();
      let imported = 0;
      const ordered = [...plan.document.entries].sort((a, b) => Number(a.kind === "folderMembership" || a.kind === "questionAnswer") - Number(b.kind === "folderMembership" || b.kind === "questionAnswer"));
      for (const e of ordered) {
        if (!selected.has(keyOf(e)))
          continue;
        const original = snapshot.get(keyOf(e));
        let body = { ...e.body } as Body;
        if (e.kind === "folder" && original && !active(original)) {
          body.id = restoredFolderId(e.id, original.deletedAt);
          folderMap.set(e.id, body.id);
          // Never revive the mapped folder if the user later deleted it too.
          if (snapshot.has(`folder:${body.id}`))
            continue;
        }
        if (e.kind === "question" && this.questionRestoreSeed(e.id, ordered.filter(item => selected.has(keyOf(item))), snapshot) !== null) {
          body.id = restoredFolderId(e.id, this.questionRestoreSeed(e.id, ordered.filter(item => selected.has(keyOf(item))), snapshot));
          questionMap.set(e.id, body.id);
          if (snapshot.has(`question:${body.id}`)) continue;
        }
        if (e.kind === "questionAnswer") {
          body.questionId = questionMap.get(body.questionId) ?? body.questionId;
          body.id = questionAnswerId(body.questionId, body.site, body.attempt);
          if (!active(snapshot.get(`question:${body.questionId}`))) continue;
          const target = snapshot.get(`questionAnswer:${body.id}`);
          if (target && !active(target)) continue;
          if (body.sealedAt === null) { body.capture = "interrupted"; body.sealedAt = Math.max(this.now(), body.createdAt); }
        }
        if (e.kind === "folderMembership") {
          body.folderId = folderMap.get(body.folderId) ?? body.folderId;
          body.id = folderMembershipId({ kind: body.targetKind, id: body.targetId }, body.folderId);
          if (!active(snapshot.get(`folder:${body.folderId}`)) || !active(snapshot.get(`${body.targetKind}:${body.targetId}`)))
            continue;
        }
        const id = String(body.id ?? e.id), current = snapshot.get(`${e.kind}:${id}`);
        if (active(current) && JSON.stringify(comparison(projectBody(e.kind, current))) === JSON.stringify(comparison(body)))
          continue;
        const stamp = Math.max(this.now(), Number(body.updatedAt) + 1, Number(body.createdAt) || 0, Number(body.lastUsedAt ?? 0) + 1, Number(current?.updatedAt ?? 0) + 1, Number(current?.lastUsedAt ?? 0) + 1, Number(current?.deletedAt ?? 0) + 1, Number(original?.updatedAt ?? 0) + 1);
        if (!Number.isSafeInteger(stamp))
          throw new Error("backup_invalid");
        body = { ...body, updatedAt: stamp, deviceId: this.options.deviceId() };
        if (e.kind === "history")
          body.lastUsedAt = Math.max(stamp, body.lastUsedAt);
        // Revalidate immediately before writing; device identifiers never originate in the document.
        projectBody(e.kind, body);
        this.put(e.kind, id, body);
        snapshot.set(`${e.kind}:${id}`, body);
        imported++;
      }
      this.plans.delete(token);
      return { imported, skipped: plan.document.entries.length - imported };
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
