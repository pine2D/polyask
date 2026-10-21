import { BACKUP_CONTAINER_MAX_BYTES, BACKUP_MAGIC, BACKUP_MAX_BYTES, BACKUP_MAX_ENTRIES,
  type BackupDocument, type BackupEntry, type BackupOmission, type BackupPayload } from '../shared/backup';
import { MAX_IMAGE_BYTES } from '../shared/images';
import { isQuestionImageMetadata, type QuestionAttachmentsManifest } from '../shared/question-attachments';
import { validateBackup } from './backup-validation';

export const payloadKey = (index: number) => `images/${index}.bin`;
export function attachmentBody(entry: BackupEntry): Omit<QuestionAttachmentsManifest, 'deviceId'> {
  return entry.body as unknown as Omit<QuestionAttachmentsManifest, 'deviceId'>;
}
/** v4 is a closed envelope: every image-bearing parent is complete or explicitly omitted. */
export function validateContainerManifest(value: unknown): BackupDocument {
  const document = validateBackup(value);
  if (document.version !== 4) throw new Error('backup_version');
  const raw = value as Record<string, unknown>;
  if (Object.keys(raw).some(key => !['format', 'version', 'exportedAt', 'entries', 'payloads', 'omissions'].includes(key)) ||
    !Array.isArray(raw.payloads) || !Array.isArray(raw.omissions)) throw new Error('backup_invalid');
  const parents = new Map(document.entries.filter(e => e.kind === 'question').map(e => [e.id, e.body]));
  const covered = new Set<string>();
  const expected: BackupPayload[] = [];
  for (const entry of document.entries.filter(e => e.kind === 'questionAttachments')) {
    const b = attachmentBody(entry), parent = parents.get(b.questionId);
    if (!parent || parent.inputImageCount !== b.images.length || parent.createdAt !== b.createdAt || covered.has(b.questionId))
      throw new Error('backup_dependency');
    covered.add(b.questionId);
    b.images.forEach((img, index) => expected.push({ key: payloadKey(expected.length), setId: b.id, index, size: img.size, sha256: img.sha256 }));
  }
  if (raw.payloads.length !== expected.length || expected.length + document.entries.length > BACKUP_MAX_ENTRIES)
    throw new Error('backup_invalid');
  for (const [index, value] of raw.payloads.entries()) {
    const want = expected[index];
    if (!value || typeof value !== 'object' || Object.keys(value).length !== 5 ||
      Object.entries(want).some(([key, field]) => value[key] !== field)) throw new Error('backup_invalid');
  }
  const omissions: BackupOmission[] = raw.omissions.map(value => {
    if (!value || typeof value !== 'object' || Object.keys(value).length !== 3 ||
      !Object.keys(value).every(key => ['questionId', 'count', 'images'].includes(key))) throw new Error('backup_invalid');
    const { questionId, count, images } = value;
    const parent = parents.get(questionId);
    if (!parent || covered.has(questionId) || count !== parent.inputImageCount || !Number.isInteger(count) || count < 1 || count > 4 ||
      !Array.isArray(images) || (images.length !== 0 && images.length !== count) || !images.every(isQuestionImageMetadata) || images.reduce((total: number, image: { size: number }) => total + image.size, 0) > MAX_IMAGE_BYTES)
      throw new Error('backup_invalid');
    covered.add(questionId);
    return { questionId, count, images };
  });
  if ([...parents].some(([id, b]) => Number(b.inputImageCount) > 0 && !covered.has(id))) throw new Error('backup_dependency');
  const manifest = { ...document, payloads: expected, omissions };
  const length = Buffer.byteLength(JSON.stringify(manifest));
  if (length > BACKUP_MAX_BYTES || Buffer.byteLength(BACKUP_MAGIC) + 4 + length + expected.reduce((n, p) => n + p.size, 0) > BACKUP_CONTAINER_MAX_BYTES)
    throw new Error('backup_too_large');
  return manifest;
}
