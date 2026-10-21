import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { MAX_IMAGE_COUNT, type DesktopImage } from '../shared/images';
import { isStoredQuestionAttachmentManifest, type QuestionAttachmentsManifest, type QuestionAttachmentsTombstone,
  type StoredQuestionAttachmentManifest, type StoredQuestionAttachments } from '../shared/question-attachments';
import { isStoredQuestion, type QuestionRecord, type StoredQuestion } from '../shared/question-history';
import { compareSyncVersion, nextSyncTime } from '../shared/sync';
import type { OutboxRepository } from './outbox-repository';
import { inTransaction, readJson } from './repository-utils';
import { decodeQuestionAttachments, originalImages, verifyQuestionImage } from './question-attachment-validation';

export function questionAttachmentId(questionId: string): string {
  return createHash('sha256').update(JSON.stringify(['questionAttachments', questionId])).digest('hex');
}
export class QuestionAttachmentRepository {
  constructor(private readonly db: DatabaseSync, private readonly outbox: OutboxRepository) {}
  get(id: string): StoredQuestionAttachmentManifest | null {
    const row = this.db.prepare('SELECT body,question_id,deleted_at FROM question_attachment_sets WHERE id=?').get(id);
    if (!row) return null;
    const value = readJson<StoredQuestionAttachmentManifest>(row);
    if (!isStoredQuestionAttachmentManifest(value) || value.id !== id || value.id !== questionAttachmentId(value.questionId) || row.question_id !== value.questionId ||
      row.deleted_at !== ('deletedAt' in value ? value.deletedAt : null)) {
      throw new Error('invalid_question_attachments');
    }
    return value;
  }
  forQuestion(questionId: string): StoredQuestionAttachmentManifest | null { return this.get(questionAttachmentId(questionId)); }
  all(): StoredQuestionAttachmentManifest[] {
    return this.db.prepare('SELECT id FROM question_attachment_sets ORDER BY id').all().map(row => this.get(String(row.id))!);
  }
  private parent(questionId: string): StoredQuestion | null {
    const row = this.db.prepare('SELECT body FROM questions WHERE id=?').get(questionId);
    if (!row) return null;
    const parent = readJson<StoredQuestion>(row);
    if (!isStoredQuestion(parent) || parent.id !== questionId) throw new Error('invalid_question_attachments');
    return parent;
  }
  private checkParent(value: QuestionAttachmentsManifest, requireLive = false): void {
    const parent = this.parent(value.questionId);
    if ((requireLive && !parent) || (parent && ('deletedAt' in parent || parent.inputImageCount !== value.images.length ||
      parent.createdAt !== value.createdAt))) throw new Error('question_attachments_unavailable');
  }
  private enqueue(id: string): void {
    this.outbox.enqueue({ key: `questionAttachments:${id}`, kind: 'questionAttachments', entityId: id, nextAt: 0, attempt: 0 });
  }
  save(question: QuestionRecord, images: readonly DesktopImage[]): void {
    if (!isStoredQuestion(question) || 'deletedAt' in question) throw new Error('invalid_question_attachments');
    const parent = this.parent(question.id);
    if (!parent || 'deletedAt' in parent || parent.createdAt !== question.createdAt || parent.deviceId !== question.deviceId ||
      parent.inputImageCount !== question.inputImageCount) throw new Error('question_attachments_unavailable');
    if (images.length === 0 && question.inputImageCount === 0) return;
    this.put({ schema: 5, id: questionAttachmentId(question.id), questionId: question.id,
      createdAt: question.createdAt, updatedAt: question.createdAt, deviceId: question.deviceId, images: originalImages(images) });
  }
  put(wire: StoredQuestionAttachments, enqueue = true): void {
    const decoded = decodeQuestionAttachments(wire);
    let value = decoded.manifest;
    if (value.id !== questionAttachmentId(value.questionId)) throw new Error('invalid_question_attachments');
    inTransaction(this.db, () => {
      const current = this.get(value.id), parent = this.parent(value.questionId);
      if (current && 'deletedAt' in current && !('deletedAt' in value)) { this.enqueue(current.id); return; }
      if (parent && 'deletedAt' in parent && !('deletedAt' in value)) {
        value = this.tombstone(value, parent.deletedAt, parent.deviceId); enqueue = true;
      }
      if (!('deletedAt' in value)) this.checkParent(value);
      if (current && current.createdAt !== value.createdAt) throw new Error('immutable_question_attachments');
      if (current && !('deletedAt' in current) && !('deletedAt' in value)) {
        if (JSON.stringify(current.images) !== JSON.stringify(value.images)) throw new Error('immutable_question_attachments');
        const order = compareSyncVersion(value, current);
        if (order < 0) { if (!enqueue) this.enqueue(current.id); return; }
        if (order === 0) {
          try { this.payloads(current); return; }
          catch { /* An identical verified wire may repair missing/corrupt local BLOBs. */ }
        }
      }
      if (current && 'deletedAt' in current && 'deletedAt' in value && compareSyncVersion(value, current) <= 0) {
        if (!enqueue && compareSyncVersion(value, current) < 0) this.enqueue(current.id); return;
      }
      this.db.prepare(`INSERT INTO question_attachment_sets(id,question_id,body,deleted_at) VALUES(?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET body=excluded.body,deleted_at=excluded.deleted_at`)
        .run(value.id, value.questionId, JSON.stringify(value), 'deletedAt' in value ? value.deletedAt : null);
      this.db.prepare('DELETE FROM question_attachment_items WHERE set_id=?').run(value.id);
      if (!('deletedAt' in value)) {
        const insert = this.db.prepare('INSERT INTO question_attachment_items(set_id,image_index,data) VALUES(?,?,?)');
        decoded.bytes.forEach((bytes, index) => insert.run(value.id, index, bytes));
      }
      if (enqueue) this.enqueue(value.id);
    });
  }
  project(id: string): StoredQuestionAttachments | null {
    const manifest = this.get(id);
    if (!manifest || 'deletedAt' in manifest) return manifest;
    const images = this.payloads(manifest).map((bytes, index) => ({ ...manifest.images[index], base64: bytes.toString('base64') }));
    return { ...manifest, images };
  }
  private payloads(manifest: QuestionAttachmentsManifest, requireLive = false): Buffer[] {
    this.checkParent(manifest, requireLive);
    const rows = this.db.prepare('SELECT image_index,data FROM question_attachment_items WHERE set_id=? ORDER BY image_index').all(manifest.id);
    if (rows.length !== manifest.images.length) throw new Error('question_attachments_unavailable');
    return rows.map((row, index) => {
      if (row.image_index !== index || !(row.data instanceof Uint8Array)) throw new Error('invalid_question_attachments');
      const bytes = Buffer.from(row.data); verifyQuestionImage(manifest.images[index], bytes); return bytes;
    });
  }
  readAll(questionId: string): DesktopImage[] {
    const manifest = this.forQuestion(questionId);
    if (!manifest || 'deletedAt' in manifest) throw new Error('question_attachments_unavailable');
    return this.payloads(manifest, true).map((bytes, index) => {
      const { name, type, size } = manifest.images[index];
      return { name, type, size, dataUrl: `data:${type};base64,${bytes.toString('base64')}` };
    });
  }
  readImage(questionId: string, index: number): DesktopImage {
    if (!Number.isSafeInteger(index) || index < 0 || index >= MAX_IMAGE_COUNT) throw new Error('invalid_question_attachments');
    const images = this.readAll(questionId);
    if (!images[index]) throw new Error('question_attachments_unavailable');
    return images[index];
  }
  private tombstone(current: StoredQuestionAttachmentManifest, now: number, deviceId: string): QuestionAttachmentsTombstone {
    const updatedAt = nextSyncTime(now, current.updatedAt);
    return { schema: 5, id: current.id, questionId: current.questionId, createdAt: current.createdAt,
      updatedAt, deletedAt: updatedAt, deviceId };
  }
  deleteForQuestion(questionId: string, now: number, deviceId: string): void {
    const current = this.forQuestion(questionId);
    if (current && !('deletedAt' in current)) this.put(this.tombstone(current, now, deviceId));
    if (!current) {
      const parent = this.parent(questionId);
      if (!parent || 'deletedAt' in parent || parent.inputImageCount === 0) return;
      const updatedAt = nextSyncTime(now, parent.updatedAt);
      this.put({ schema: 5, id: questionAttachmentId(questionId), questionId, createdAt: parent.createdAt,
        updatedAt, deletedAt: updatedAt, deviceId });
    }
  }
}
