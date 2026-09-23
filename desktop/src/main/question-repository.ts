import { safeQuestionUrl } from "./question-navigation";
import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { isStoredQuestion, isStoredQuestionAnswer, type QuestionAnswerIdentity, type QuestionAnswerRecord,
  type QuestionAnswerTombstone, type QuestionDetail, type QuestionFilters, type QuestionLegacyPage, type QuestionPage, type QuestionRecord,
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
  lifecycle = 0;
  invalidateLifecycle(): void { this.lifecycle++; }
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
      if (current && compareSyncVersion(value, current) < 0 && (!("deletedAt" in value) || "deletedAt" in current)) return;
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
  putAnswer(value: StoredQuestionAnswer, enqueue = true, nextAt = 0, restore = false): void {
    if (!isStoredQuestionAnswer(value) || value.id !== questionAnswerId(value.questionId, value.site, value.attempt)) throw new Error("invalid_question_answer");
    if (!("deletedAt" in value) && value.conversationUrl) value = { ...value, conversationUrl: safeQuestionUrl(value.site, value.conversationUrl) };
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
      if (current && "deletedAt" in current && "deletedAt" in value && compareSyncVersion(value, current) <= 0) return;
      if (current && !("deletedAt" in value)) {
        if (compareSyncVersion(value, current) <= 0) return;
        if (!("deletedAt" in current) && current.sealedAt !== null && !restore && (enqueue || value.sealedAt === null) &&
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
  detail(id: string, answerId?: string): QuestionDetail | null {
    const question = this.get(id);
    if (!question || "deletedAt" in question) return null;
    const answers = this.db.prepare("SELECT json_set(body, '$.answerMarkdown', NULL) AS body FROM question_answers WHERE question_id = ? AND deleted_at IS NULL ORDER BY attempt,site").all(id)
      .flatMap(row => { const answer = readJson<QuestionAnswerRecord>(row); return answer && question.sites.includes(answer.site) ? [answer] : []; });
    const selected = answerId ? answers.find(a => a.id === answerId) : answers.filter(a => a.site === question.sites[0]).at(-1);
    if (answerId && !selected) throw new Error("history_not_found");
    const full = selected ? this.getAnswer(selected.id) : null;
    return { question, loadedAnswerId: selected?.id ?? null, answers: answers.map(a => full && !("deletedAt" in full) && a.id === full.id ? full : a) };
  }
  legacy(filters: QuestionFilters = {}): QuestionLegacyPage {
    const query = (filters.query ?? "").trim().toLocaleLowerCase();
    let cursor: [number, string] | null = null;
    try { if (filters.cursor) cursor = JSON.parse(filters.cursor); } catch { throw new Error("invalid_question_query"); }
    if (query.length > 1000 || (cursor && (!Array.isArray(cursor) || cursor.length !== 2 || !Number.isSafeInteger(cursor[0]) || typeof cursor[1] !== "string"))) throw new Error("invalid_question_query");
    const rows = this.db.prepare(`SELECT h.id, h.sort_time, json_extract(h.body, '$.text') AS text FROM history h
      WHERE h.deleted_at IS NULL AND (? = '' OR instr(lower(json_extract(h.body, '$.text')), ?) > 0)
      AND NOT EXISTS (SELECT 1 FROM questions q WHERE json_extract(q.body, '$.text') = json_extract(h.body, '$.text'))
      AND (? IS NULL OR h.sort_time < ? OR (h.sort_time = ? AND h.id > ?))
      ORDER BY h.sort_time DESC,h.id LIMIT 51`).all(query, query, cursor?.[0] ?? null, cursor?.[0] ?? null, cursor?.[0] ?? null, cursor?.[1] ?? "");
    const items = rows.slice(0, 50).map(row => ({ id: String(row.id), text: String(row.text), lastUsedAt: Number(row.sort_time) }));
    const last = items.at(-1);
    return { items, cursor: rows.length > 50 && last ? JSON.stringify([last.lastUsedAt, last.id]) : null };
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
    const selected = records.slice(0, limit);
    type Summary = { metadata: Omit<QuestionAnswerRecord, "answerMarkdown">; saved: boolean };
    const byQuestion = new Map<string, Summary[]>();
    if (selected.length) {
      const rows = this.db.prepare(`SELECT json_remove(body, '$.answerMarkdown') AS body,
        length(json_extract(body, '$.answerMarkdown')) > 0 AS saved FROM question_answers
        WHERE question_id IN (${selected.map(() => '?').join(',')}) AND deleted_at IS NULL
        ORDER BY question_id,attempt,site`).all(...selected.map(q => q.id));
      for (const row of rows) {
        const metadata = readJson<Summary["metadata"]>(row);
        if (!metadata) continue;
        const entries = byQuestion.get(metadata.questionId) ?? [];
        entries.push({ metadata, saved: row.saved === 1 });
        byQuestion.set(metadata.questionId, entries);
      }
    }
    const items = selected.map(record => {
      const entries = (byQuestion.get(record.id) ?? []).filter(e => record.sites.includes(e.metadata.site));
      return { ...record, savedSites: new Set(entries.filter(e => e.saved).map(e => e.metadata.site)).size,
        answers: entries.map(e => e.metadata) };
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
