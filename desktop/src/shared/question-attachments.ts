import { IMAGE_TYPES, MAX_IMAGE_BYTES, MAX_IMAGE_COUNT, type DesktopImageType } from './images';
import { questionIdValid } from './question-history';
import { validSyncTime } from './sync';

export interface QuestionReask { readonly questionId: string; readonly text: string; readonly images: readonly import('./images').DesktopImage[] }

export const QUESTION_ATTACHMENTS_SCHEMA = 5;
export interface QuestionImageMetadata {
  readonly name: string;
  readonly type: DesktopImageType;
  readonly size: number;
  readonly sha256: string;
}
export interface QuestionAttachmentsIdentity {
  readonly schema: 5;
  readonly id: string;
  readonly questionId: string;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly deviceId: string;
}
export interface QuestionAttachmentsManifest extends QuestionAttachmentsIdentity {
  readonly images: readonly QuestionImageMetadata[];
}
export interface QuestionAttachmentsRecord extends QuestionAttachmentsIdentity {
  readonly images: readonly (QuestionImageMetadata & { readonly base64: string })[];
}
export interface QuestionAttachmentsTombstone extends QuestionAttachmentsIdentity { readonly deletedAt: number }
export type StoredQuestionAttachmentManifest = QuestionAttachmentsManifest | QuestionAttachmentsTombstone;
export type StoredQuestionAttachments = QuestionAttachmentsRecord | QuestionAttachmentsTombstone;

const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const only = (v: Record<string, unknown>, keys: readonly string[]) => Object.keys(v).length === keys.length && Object.keys(v).every(k => keys.includes(k));
const IDENTITY = ['schema', 'id', 'questionId', 'createdAt', 'updatedAt', 'deviceId'];
const IMAGE = ['name', 'type', 'size', 'sha256'];
export function isQuestionImageMetadata(v: unknown): v is QuestionImageMetadata {
  return object(v) && only(v, IMAGE) && imageFields(v);
}
function imageFields(v: Record<string, unknown>): boolean {
  return typeof v.name === 'string' && !!v.name.trim() && [...v.name].length <= 128 &&
    v.name !== '.' && v.name !== '..' && !/[\\/\x00-\x1f\x7f]/.test(v.name) &&
    IMAGE_TYPES.includes(v.type as DesktopImageType) && Number.isSafeInteger(v.size) && Number(v.size) > 0 &&
    Number(v.size) <= MAX_IMAGE_BYTES && typeof v.sha256 === 'string' && /^[a-f0-9]{64}$/.test(v.sha256);
}
function stored(v: unknown, wire: boolean): boolean {
  if (!object(v) || v.schema !== QUESTION_ATTACHMENTS_SCHEMA || typeof v.id !== 'string' || !/^[a-f0-9]{64}$/.test(v.id) ||
    !questionIdValid(v.questionId) || !questionIdValid(v.deviceId) || !validSyncTime(v.createdAt) ||
    !validSyncTime(v.updatedAt) || v.updatedAt < v.createdAt) return false;
  if ('deletedAt' in v) return only(v, [...IDENTITY, 'deletedAt']) && validSyncTime(v.deletedAt) &&
    v.deletedAt >= v.createdAt && v.updatedAt >= v.deletedAt;
  if (!only(v, [...IDENTITY, 'images']) || !Array.isArray(v.images) || !v.images.length || v.images.length > MAX_IMAGE_COUNT) return false;
  let total = 0;
  return v.images.every(img => {
    if (!object(img) || !only(img, wire ? [...IMAGE, 'base64'] : IMAGE) || !imageFields(img)) return false;
    total += Number(img.size);
    return total <= MAX_IMAGE_BYTES && (!wire || (typeof img.base64 === 'string' &&
      img.base64.length === 4 * Math.ceil(Number(img.size) / 3) && /^[A-Za-z0-9+/]+={0,2}$/.test(img.base64)));
  });
}
/** Structural validation only; main verifies decoded bytes, MIME and SHA-256 before persistence/use. */
export function isStoredQuestionAttachments(v: unknown): v is StoredQuestionAttachments { return stored(v, true); }
export function isStoredQuestionAttachmentManifest(v: unknown): v is StoredQuestionAttachmentManifest { return stored(v, false); }
