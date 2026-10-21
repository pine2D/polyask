import { createHash } from 'node:crypto';
import { validateImageFiles, type DesktopImage } from '../shared/images';
import { isStoredQuestionAttachments, type QuestionImageMetadata, type StoredQuestionAttachmentManifest,
  type StoredQuestionAttachments } from '../shared/question-attachments';

export function verifyQuestionImage(metadata: QuestionImageMetadata, bytes: Uint8Array): void {
  const signature = metadata.type === 'image/png' ? [137, 80, 78, 71, 13, 10, 26, 10] : [255, 216, 255];
  if (bytes.byteLength !== metadata.size || !signature.every((byte, i) => bytes[i] === byte) ||
    createHash('sha256').update(bytes).digest('hex') !== metadata.sha256) throw new Error('invalid_question_attachments');
}
export function decodeQuestionAttachments(value: unknown): {
  manifest: StoredQuestionAttachmentManifest; bytes: readonly Buffer[];
} {
  if (!isStoredQuestionAttachments(value)) throw new Error('invalid_question_attachments');
  if ('deletedAt' in value) return { manifest: value, bytes: [] };
  const { images, ...identity } = value;
  const bytes = images.map(img => {
    const decoded = Buffer.from(img.base64, 'base64');
    if (decoded.toString('base64') !== img.base64) throw new Error('invalid_question_attachments');
    verifyQuestionImage(img, decoded);
    return decoded;
  });
  return { manifest: { ...identity, images: images.map(({ name, type, size, sha256 }) => ({ name, type, size, sha256 })) }, bytes };
}
export function originalImages(images: readonly DesktopImage[]): Extract<StoredQuestionAttachments, { images: unknown }>['images'] {
  if (validateImageFiles(images)) throw new Error('invalid_question_attachments');
  return images.map(img => {
    const prefix = `data:${img.type};base64,`;
    if (typeof img.dataUrl !== 'string' || !img.dataUrl.startsWith(prefix) ||
      img.dataUrl.length !== prefix.length + 4 * Math.ceil(img.size / 3)) throw new Error('invalid_question_attachments');
    const base64 = img.dataUrl.slice(prefix.length);
    return { name: img.name, type: img.type, size: img.size, base64,
      sha256: createHash('sha256').update(Buffer.from(base64, 'base64')).digest('hex') };
  });
}
/** Preserve original request identity even when its independent BLOB transaction fails. */
export function originalImageRequestKey(images: readonly DesktopImage[]): string {
  const hash = createHash('sha256');
  for (const image of images) hash.update(JSON.stringify([image.name, image.type, image.size, image.dataUrl]));
  return hash.digest('hex');
}
