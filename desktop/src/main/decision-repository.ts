import type { DatabaseSync } from "node:sqlite";
import { isStoredDecision, type DecisionRecord, type StoredDecision } from "../shared/decision";
import type { OutboxRepository } from "./outbox-repository";
import { inTransaction, readJson } from "./repository-utils";

export class DecisionRepository {
  constructor(private readonly database: DatabaseSync, private readonly outbox: OutboxRepository) {}

  get(id: string): StoredDecision | null {
    return readJson<StoredDecision>(this.database.prepare("SELECT body FROM decisions WHERE id = ?").get(id));
  }

  list(): DecisionRecord[] {
    return this.database.prepare("SELECT body FROM decisions WHERE deleted_at IS NULL ORDER BY sort_time DESC, id DESC")
      .all().flatMap(row => readJson<DecisionRecord>(row) ?? []);
  }

  put(record: StoredDecision, enqueue = true): StoredDecision {
    if (!isStoredDecision(record)) throw new Error("invalid_decision");
    const write = () => {
      this.database.prepare(`INSERT INTO decisions (id, body, sort_time, deleted_at) VALUES (?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET body=excluded.body, sort_time=excluded.sort_time, deleted_at=excluded.deleted_at`)
        .run(record.id, JSON.stringify(record), record.updatedAt, "deletedAt" in record ? record.deletedAt : null);
      if (enqueue) this.outbox.enqueue({key:`decision:${record.id}`,kind:"decision",entityId:record.id,nextAt:0,attempt:0});
      return record;
    };
    return enqueue ? inTransaction(this.database, write) : write();
  }

  delete(id: string, now: number, deviceId: string): StoredDecision | null {
    const record = this.get(id);
    if (!record) return null;
    const stamp = Math.max(now, record.updatedAt + 1, "deletedAt" in record ? record.deletedAt + 1 : 0);
    return this.put({id,createdAt:record.createdAt,updatedAt:stamp,deletedAt:stamp,deviceId,schema:2});
  }
}
