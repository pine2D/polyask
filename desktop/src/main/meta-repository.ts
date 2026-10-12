import type { DatabaseSync } from "node:sqlite";

import { readJson } from "./repository-utils";

export class MetaRepository {
  constructor(private readonly database: DatabaseSync) {}

  get<T = unknown>(key: string): T | null {
    const row = this.database.prepare("SELECT body FROM meta WHERE key = ?").get(key);
    return readJson<T>(row);
  }

  /** get 对损坏正文也返回 null；需要区分「不存在」与「存在但读不出」时用它（proxy 的 fail-closed 分类）。 */
  has(key: string): boolean {
    return this.database.prepare("SELECT 1 FROM meta WHERE key = ?").get(key) !== undefined;
  }

  put<T>(key: string, value: T): T {
    if (!key) throw new Error("invalid_meta_key");
    this.database.prepare(`
      INSERT INTO meta (key, body) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET body = excluded.body
    `).run(key, JSON.stringify(value));
    return value;
  }

  delete(key: string): void {
    this.database.prepare("DELETE FROM meta WHERE key = ?").run(key);
  }
}
