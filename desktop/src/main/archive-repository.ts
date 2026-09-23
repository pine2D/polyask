import type { DatabaseSync } from "node:sqlite";

import {
  isArchiveRecord,
  tombstoneArchive,
  type ArchiveFilters,
  type ArchiveRecord,
  type StoredArchive
} from "../shared/archive";
import { SYNC_SCHEMA, validSyncTime } from "../shared/sync";
import { OutboxRepository } from "./outbox-repository";
import { inTransaction, readJson } from "./repository-utils";

function isStoredArchive(value: StoredArchive): boolean {
  return "deletedAt" in value
    ? !!value.id && value.schema === SYNC_SCHEMA && [value.createdAt, value.updatedAt, value.deletedAt].every(validSyncTime)
    : isArchiveRecord(value);
}

export class ArchiveRepository {
  constructor(
    private readonly database: DatabaseSync,
    private readonly outbox: OutboxRepository
  ) {}

  get(id: string): StoredArchive | null {
    const row = this.database.prepare("SELECT body FROM archives WHERE id = ?").get(id);
    return readJson<StoredArchive>(row);
  }

  list(): ArchiveRecord[] {
    const rows = this.database.prepare(
      "SELECT body FROM archives WHERE deleted_at IS NULL ORDER BY sort_time DESC, id DESC"
    ).all();
    // 读路径只挡 JSON 解析失败：入库时 put() 已用 isStoredArchive 校验过。这里若再跑一遍 isArchiveRecord，
    // 任何一次校验收紧都会把存量记录静默过滤掉——不报错、不计数、不落日志，用户只看到结果库凭空少了几条。
    // deleted_at IS NULL 已排除 tombstone。
    return rows.flatMap((row) => readJson<ArchiveRecord>(row) ?? []);
  }

  search(filters: ArchiveFilters): ArchiveRecord[] {
    const query = String(filters.query ?? "").trim().toLowerCase();
    const tag = String(filters.tag ?? "").trim();
    // Filter in SQLite so unrelated answer bodies never cross into JS or IPC.
    // Use instr rather than LIKE: %, _ and Unicode keep their literal meaning.
    const rows = this.database.prepare(`SELECT body FROM archives WHERE deleted_at IS NULL
      AND CASE WHEN json_valid(body) THEN
        (? = '' OR instr(json_extract(body, '$.searchText'), ?) > 0)
        AND (? = 0 OR json_extract(body, '$.favorite') = 1)
        AND (? = '' OR EXISTS (SELECT 1 FROM json_each(body, '$.tags') WHERE value = ?))
      ELSE 0 END ORDER BY sort_time DESC, id DESC`).all(query, query, filters.favorite ? 1 : 0, tag, tag);
    return rows.flatMap(row => readJson<ArchiveRecord>(row) ?? []);
  }

  tags(): string[] {
    const rows = this.database.prepare(`SELECT json_extract(body, '$.tags') AS body FROM archives
      WHERE deleted_at IS NULL AND json_valid(body)`).all();
    return [...new Set(rows.flatMap(row => readJson<string[]>(row) ?? []))]
      .sort((left, right) => left.localeCompare(right));
  }

  put(record: StoredArchive, enqueue = true): StoredArchive {
    if (!isStoredArchive(record)) throw new Error("invalid_archive");
    const write = () => {
      this.database.prepare(`
        INSERT INTO archives (id, body, sort_time, deleted_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET body = excluded.body, sort_time = excluded.sort_time, deleted_at = excluded.deleted_at
      `).run(
        record.id,
        JSON.stringify(record),
        record.createdAt,
        "deletedAt" in record ? record.deletedAt : null
      );
      if (enqueue) this.outbox.enqueue({
        key: `archive:${record.id}`,
        kind: "archive",
        entityId: record.id,
        nextAt: 0,
        attempt: 0
      });
      return record;
    };
    return enqueue ? inTransaction(this.database, write) : write();
  }

  delete(id: string, now: number, deviceId: string): StoredArchive | null {
    const current = this.get(id);
    if (!current) return null;
    return this.put(tombstoneArchive(current, now, deviceId));
  }
}
