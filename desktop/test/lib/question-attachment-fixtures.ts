import { createHash } from 'node:crypto';
import type { DesktopImage, DesktopImageType } from '../../src/shared/images';
import type { QuestionRecord } from '../../src/shared/question-history';
import { questionAttachmentId } from '../../src/main/question-attachment-repository';

export function image(name = 'original.png', type: DesktopImageType = 'image/png', size = 16): DesktopImage {
  const bytes = Buffer.alloc(size, 23);
  Buffer.from(type === 'image/png' ? [137, 80, 78, 71, 13, 10, 26, 10] : [255, 216, 255, 225, 0, 12, 69, 120, 105, 102, 0, 0]).copy(bytes);
  return { name, type, size, dataUrl: `data:${type};base64,${bytes.toString('base64')}` };
}
export function question(id = 'q-a', inputImageCount = 1): QuestionRecord {
  return { schema: 4, id, text: '原图提问', sites: ['claude'], requestedTier: null, inputImageCount,
    createdAt: 10, updatedAt: 10, deviceId: 'device-a' };
}
export function wire(questionId = 'q-a', images: readonly DesktopImage[] = [image()]) {
  return { schema: 5 as const, id: questionAttachmentId(questionId), questionId, createdAt: 10, updatedAt: 10, deviceId: 'device-a',
    images: images.map(img => { const base64 = img.dataUrl.split(',')[1]; return { name: img.name, type: img.type, size: img.size,
      sha256: createHash('sha256').update(Buffer.from(base64, 'base64')).digest('hex'), base64 }; }) };
}
