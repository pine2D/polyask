import type { DatabaseSync } from "node:sqlite";
import { isStoredTaskFolder, isStoredFolderMembership, type StoredTaskFolder, type StoredFolderMembership, type TaskFolder } from "../shared/task-folder";
import type { OutboxRepository } from "./outbox-repository";
import { inTransaction, readJson } from "./repository-utils";

export class TaskFolderRepository {
  private depth = 0;
  constructor(private readonly database: DatabaseSync, private readonly outbox: OutboxRepository) {}

  transaction<T>(action: () => T): T {
    if (this.depth) return action();
    return inTransaction(this.database, () => {
      this.depth++;
      try { return action(); } finally { this.depth--; }
    });
  }
  get(id: string): StoredTaskFolder | null {
    return readJson(this.database.prepare("SELECT body FROM folders WHERE id = ?").get(id));
  }
  list(): TaskFolder[] {
    return this.database.prepare("SELECT body FROM folders WHERE deleted_at IS NULL").all()
      .flatMap(row => {const v=readJson<unknown>(row);return isStoredTaskFolder(v) && !("deletedAt" in v) ? [v] : [];})
      .sort((a,b)=>a.name.localeCompare(b.name)||a.id.localeCompare(b.id));
  }
  put(record: StoredTaskFolder, enqueue = true): StoredTaskFolder {
    if (!isStoredTaskFolder(record)) throw new Error("invalid_request");
    return this.transaction(() => {
      this.database.prepare(`INSERT INTO folders (id,body,deleted_at) VALUES (?,?,?)
        ON CONFLICT(id) DO UPDATE SET body=excluded.body,deleted_at=excluded.deleted_at`)
        .run(record.id,JSON.stringify(record),"deletedAt" in record ? record.deletedAt : null);
      if (enqueue) this.outbox.enqueue({key:`folder:${record.id}`,kind:"folder",entityId:record.id,nextAt:0,attempt:0});
      return record;
    });
  }
  getMembership(id: string): StoredFolderMembership | null {
    return readJson(this.database.prepare("SELECT body FROM folder_memberships WHERE id = ?").get(id));
  }
  listMemberships(): StoredFolderMembership[] {
    return this.database.prepare("SELECT body FROM folder_memberships ORDER BY id").all()
      .flatMap(row => {const v=readJson<unknown>(row);return isStoredFolderMembership(v) ? [v] : [];});
  }
  putMembership(record: StoredFolderMembership, enqueue = true): StoredFolderMembership {
    if (!isStoredFolderMembership(record)) throw new Error("invalid_request");
    return this.transaction(() => {
      this.database.prepare(`INSERT INTO folder_memberships (id,folder_id,target_kind,target_id,body) VALUES (?,?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET body=excluded.body`)
        .run(record.id,record.folderId,record.targetKind,record.targetId,JSON.stringify(record));
      if (enqueue) this.outbox.enqueue({key:`folderMembership:${record.id}`,kind:"folderMembership",entityId:record.id,nextAt:0,attempt:0});
      return record;
    });
  }
  delete(id: string, now: number, deviceId: string): boolean {
    const folder = this.get(id);
    if (!folder || "deletedAt" in folder) return false;
    return this.transaction(() => {
      const stamp=Math.max(now,folder.updatedAt+1);
      this.put({id,createdAt:folder.createdAt,updatedAt:stamp,deletedAt:stamp,deviceId,schema:3});
      for (const member of this.listMemberships()) {
        if (member.folderId !== id || "deletedAt" in member) continue;
        const updatedAt=Math.max(stamp,member.updatedAt+1);
        this.putMembership({...member,updatedAt,deletedAt:updatedAt,deviceId});
      }
      return true;
    });
  }
}
