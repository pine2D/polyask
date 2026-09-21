import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { isStoredQuestion, isStoredQuestionAnswer, type QuestionAnswerIdentity, type QuestionAnswerRecord,
  type QuestionAnswerTombstone, type QuestionFilters, type QuestionPage, type QuestionRecord,
  type QuestionTombstone, type QuestionVersion, type StoredQuestion, type StoredQuestionAnswer } from "../shared/question-history";
import { compareSyncVersion } from "../shared/sync";
import type { OutboxRepository } from "./outbox-repository";
import { inTransaction, readJson } from "./repository-utils";

export function questionAnswerId(questionId: string, site: string, attempt: number): string {
  return createHash("sha256").update(JSON.stringify([questionId, site, attempt])).digest("hex");
}
function stamp(now: number, current: { updatedAt: number; createdAt: number }): number {
  const value = Math.max(now, current.updatedAt + 1, current.createdAt);
  if (!Number.isSafeInteger(value)) throw new Error("invalid_question_time");
  return value;
}
function tombstone(record: QuestionVersion, now: number, deviceId: string): QuestionTombstone {
  const updatedAt = stamp(now, record);
  return { schema: 4, id: record.id, createdAt: record.createdAt, updatedAt, deletedAt: updatedAt, deviceId };
}
function answerTombstone(record: QuestionAnswerIdentity, now: number, deviceId: string): QuestionAnswerTombstone {
  return { ...tombstone(record, now, deviceId), questionId: record.questionId, site: record.site, attempt: record.attempt };
}

export class QuestionRepository {
  constructor(private readonly db: DatabaseSync, private readonly outbox: OutboxRepository) {}
  get(id: string): StoredQuestion | null {
    return readJson<StoredQuestion>(this.db.prepare("SELECT body FROM questions WHERE id = ?").get(id));
  }
  getAnswer(id: string): StoredQuestionAnswer | null {
    return readJson<StoredQuestionAnswer>(this.db.prepare("SELECT body FROM question_answers WHERE id = ?").get(id));
  }
  transaction<T>(action: () => T): T { return inTransaction(this.db, action); }
  private enqueue(kind: "question" | "questionAnswer", id: string, nextAt = 0): void {
    const key = `${kind}:${id}`;
    const pending = this.db.prepare("SELECT next_at FROM outbox WHERE key = ?").get(key);
    this.outbox.enqueue({ key, kind, entityId: id, nextAt: pending ? Math.min(Number(pending.next_at), nextAt) : nextAt, attempt: 0 });
  }
  put(value: StoredQuestion, enqueue = true): void {
    if (!isStoredQuestion(value)) throw new Error("invalid_question");
    this.transaction(() => {
      const current = this.get(value.id);
      if (current && "deletedAt" in current && !("deletedAt" in value)) {
        this.enqueue("question", current.id);
        return;
      }
      if (current && !("deletedAt" in current) && !("deletedAt" in value) &&
        JSON.stringify([current.text, current.sites, current.requestedTier, current.inputImageCount, current.createdAt]) !==
        JSON.stringify([value.text, value.sites, value.requestedTier, value.inputImageCount, value.createdAt])) throw new Error("immutable_question");
      if (current && compareSyncVersion(value, current) < 0 && !("deletedAt" in value)) return;
      this.db.prepare(`INSERT INTO questions(id, body, sort_time, deleted_at) VALUES(?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET body=excluded.body, sort_time=excluded.sort_time, deleted_at=excluded.deleted_at`)
        .run(value.id, JSON.stringify(value), value.createdAt, "deletedAt" in value ? value.deletedAt : null);
      if (enqueue) this.enqueue("question", value.id);
      if ("deletedAt" in value) {
        for (const child of this.allAnswers(value.id)) {
          if (!("deletedAt" in child)) this.putAnswer(answerTombstone(child, value.deletedAt, value.deviceId));
        }
      }
    });
  }
  putAnswer(value: StoredQuestionAnswer, enqueue = true, nextAt = 0): void {
    if (!isStoredQuestionAnswer(value) || value.id !== questionAnswerId(value.questionId, value.site, value.attempt)) throw new Error("invalid_question_answer");
    this.transaction(() => {
      const current = this.getAnswer(value.id), parent = this.get(value.questionId);
      if (current && "deletedAt" in current && !("deletedAt" in value)) {
        this.enqueue("questionAnswer", current.id);
        return;
      }
      if (parent && "deletedAt" in parent && !("deletedAt" in value)) {
        value = answerTombstone(value, parent.deletedAt, parent.deviceId);
        enqueue = true;
      }
      if (parent && !("deletedAt" in parent) && !parent.sites.includes(value.site)) throw new Error("invalid_question_answer");
      if (current && !("deletedAt" in value)) {
        if (compareSyncVersion(value, current) <= 0) return;
        if (!("deletedAt" in current) && current.sealedAt !== null &&
          (value.answerMarkdown !== current.answerMarkdown || value.conversationUrl !== current.conversationUrl || value.capture !== current.capture)) return;
      }
      this.db.prepare(`INSERT INTO question_answers(id,question_id,site,attempt,body,deleted_at) VALUES(?,?,?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET body=excluded.body, deleted_at=excluded.deleted_at`)
        .run(value.id, value.questionId, value.site, value.attempt, JSON.stringify(value), "deletedAt" in value ? value.deletedAt : null);
      if (enqueue) this.enqueue("questionAnswer", value.id, "deletedAt" in value ? 0 : nextAt);
    });
  }
  private allAnswers(questionId: string): StoredQuestionAnswer[] {
    return this.db.prepare("SELECT body FROM question_answers WHERE question_id = ? ORDER BY attempt,site").all(questionId)
      .flatMap(row => { const value = readJson<StoredQuestionAnswer>(row); return value ? [value] : []; });
  }
  answers(questionId: string): QuestionAnswerRecord[] {
    const parent = this.get(questionId);
    if (!parent || "deletedAt" in parent) return [];
    return this.allAnswers(questionId).filter((item): item is QuestionAnswerRecord => !("deletedAt" in item) && parent.sites.includes(item.site));
  }
  search(filters: QuestionFilters = {}): QuestionPage {
    const limit = Math.max(1, Math.min(100, Math.floor(filters.limit ?? 50)));
    if (!Number.isFinite(limit) || (filters.query?.length ?? 0) > 1000) throw new Error("invalid_question_query");
    let cursor: [number, string] | null = null;
    if (filters.cursor) {
      try { cursor = JSON.parse(filters.cursor); } catch { throw new Error("invalid_question_query"); }
      if (!Array.isArray(cursor) || cursor.length !== 2 || !Number.isSafeInteger(cursor[0]) || typeof cursor[1] !== "string") throw new Error("invalid_question_query");
    }
    const query = (filters.query ?? "").trim().toLocaleLowerCase();
    const records = this.db.prepare(`SELECT body FROM questions WHERE deleted_at IS NULL
      AND (? = '' OR instr(lower(json_extract(body, '$.text')), ?) > 0)
      AND (? IS NULL OR sort_time < ? OR (sort_time = ? AND id > ?))
      ORDER BY sort_time DESC,id LIMIT ?`).all(query, query, cursor?.[0] ?? null, cursor?.[0] ?? null, cursor?.[0] ?? null, cursor?.[1] ?? "", limit + 1)
      .flatMap(row => { const v = readJson<QuestionRecord>(row); return v ? [v] : []; });
    const items = records.slice(0, limit).map(record => {
      const answers = this.answers(record.id);
      return { ...record, savedSites: new Set(answers.filter(a => a.answerMarkdown).map(a => a.site)).size,
        answers: answers.map(({ answerMarkdown: _text, ...metadata }) => metadata) };
    });
    const last = items.at(-1);
    return { items, cursor: records.length > limit && last ? JSON.stringify([last.createdAt, last.id]) : null };
  }
  delete(id: string, now: number, deviceId: string): boolean {
    const current = this.get(id);
    if (!current || "deletedAt" in current) return false;
    this.put(tombstone(current, now, deviceId));
    return true;
  }
  clear(now: number, deviceId: string): number {
    return this.transaction(() => {
      const rows = this.db.prepare("SELECT id FROM questions WHERE deleted_at IS NULL").all();
      for (const row of rows) this.delete(String(row.id), now, deviceId);
      return rows.length;
    });
  }
}
