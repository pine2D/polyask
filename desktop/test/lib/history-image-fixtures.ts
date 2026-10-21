import { createHash } from 'node:crypto';
import type { DesktopImage } from '../../src/shared/images';
import { questionAttachmentId } from '../../src/main/question-attachment-repository';
// Valid 1x1 RGBA PNG: reuse in the combined UI check to verify native decoding.
export const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==';
export const originals: DesktopImage[] = ['first.png', 'second.png', 'first.png', 'last.png'].map(name => ({
  name, type: 'image/png', size: Buffer.from(PNG, 'base64').length, dataUrl: `data:image/png;base64,${PNG}`
}));
export const imageManifest = (questionId: string) => ({ schema: 5 as const, id: questionAttachmentId(questionId),
  questionId, createdAt: 10, updatedAt: 10, deviceId: 'device-a', images: originals.map(({name,type,size}) => ({
    name, type, size, sha256: createHash('sha256').update(Buffer.from(PNG, 'base64')).digest('hex')
  })) });
