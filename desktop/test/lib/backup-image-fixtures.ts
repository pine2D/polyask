import { deflateSync } from 'node:zlib';
import type { DesktopImage } from '../../src/shared/images';
import type { DesktopDatabase } from '../../src/main/database';
import { question } from './question-attachment-fixtures';

function chunk(type: string, bytes: Buffer): Buffer {
  const data = Buffer.concat([Buffer.from(type), bytes]);
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  const length = Buffer.alloc(4), checksum = Buffer.alloc(4);
  length.writeUInt32BE(bytes.length); checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([length, data, checksum]);
}
/** A decodable 2048x1536 RGB PNG with uncompressed DEFLATE: ~9 MiB, deterministic and local only. */
export function largeBackupImage(): DesktopImage {
  const width = 2048, height = 1536, header = Buffer.alloc(13);
  header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  const rows = Buffer.alloc((width * 3 + 1) * height, 180);
  for (let y = 0; y < height; y++) rows[y * (width * 3 + 1)] = 0;
  const bytes = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header),
    chunk('IDAT', deflateSync(rows, { level: 0 })), chunk('IEND', Buffer.alloc(0))]);
  return { name: 'original.png', type: 'image/png', size: bytes.length, dataUrl: `data:image/png;base64,${bytes.toString('base64')}` };
}
/** Task5 can call this with a synthetic profile and then the production BackupService.exportFile. */
export function seedLargeBackupImages(database: DesktopDatabase): number {
  const image = largeBackupImage();
  for (let i = 0; i < 4; i++) {
    const q = question(`large-${i}`); database.questions.put(q); database.questionAttachments.save(q, [image]);
  }
  return image.size;
}
