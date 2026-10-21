import { open, mkdir, mkdtemp, unlink } from 'node:fs/promises';
import { openSync, readSync, closeSync, rmSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { TextDecoder } from 'node:util';
import { BACKUP_CONTAINER_MAX_BYTES, BACKUP_MAGIC, BACKUP_MAX_BYTES, type BackupDocument, type BackupEntry } from '../shared/backup';
import { verifyQuestionImage } from './question-attachment-validation';
import { attachmentBody, validateContainerManifest } from './backup-container-manifest';
import { readBackupFile } from './backup-files';

type File = Awaited<ReturnType<typeof open>>;
export type BackupGuard = () => void;
const noop = () => {};
const magic = Buffer.from(BACKUP_MAGIC, 'ascii');
async function exact(file: File, length: number, guard: BackupGuard): Promise<Buffer> {
  const buffer = Buffer.alloc(length);
  for (let offset = 0; offset < length;) {
    guard();
    const { bytesRead } = await file.read(buffer, offset, Math.min(length - offset, 64 * 1024), null);
    guard();
    if (!bytesRead) throw new Error('backup_invalid');
    offset += bytesRead;
  }
  return buffer;
}
async function write(file: File, buffer: Uint8Array, guard: BackupGuard): Promise<void> {
  for (let offset = 0; offset < buffer.length;) {
    guard();
    const { bytesWritten } = await file.write(buffer, offset, Math.min(buffer.length - offset, 64 * 1024));
    guard();
    if (!bytesWritten) throw new Error('backup_write_failed');
    offset += bytesWritten;
  }
}
export class BackupStaging {
  private disposed = false;
  constructor(readonly document: BackupDocument, private readonly directory: string) {}
  path(index: number): string { return join(this.directory, `${index}.bin`); }
  dispose(): void { this.disposed = true; rmSync(this.directory, { recursive: true, force: true }); }
  read(entry: BackupEntry): readonly Buffer[] {
    if (this.disposed) throw new Error('backup_missing');
    const b = attachmentBody(entry);
    return b.images.map((metadata, imageIndex) => {
      const index = this.document.payloads!.findIndex(p => p.setId === entry.id && p.index === imageIndex);
      if (index < 0) throw new Error('backup_invalid');
      const fd = openSync(this.path(index), 'r');
      try {
        const bytes = Buffer.alloc(metadata.size);
        let offset = 0;
        while (offset < bytes.length) {
          const count = readSync(fd, bytes, offset, Math.min(bytes.length - offset, 64 * 1024), null);
          if (!count) throw new Error('backup_invalid');
          offset += count;
        }
        if (readSync(fd, Buffer.alloc(1), 0, 1, null)) throw new Error('backup_invalid');
        verifyQuestionImage(metadata, bytes);
        return bytes;
      } finally { closeSync(fd); }
    });
  }
}
export async function readBackupContainer(path: string, options: {
  guard?: BackupGuard; stagingRoot?: string; onStage?: (stage: BackupStaging) => void;
} = {}): Promise<{ document: unknown; staging?: BackupStaging }> {
  const guard = options.guard ?? noop;
  let file: File | undefined, staging: BackupStaging | undefined;
  try {
    guard(); file = await open(path, 'r'); guard();
    const stat = await file.stat(); guard();
    if (!stat.isFile()) throw new Error('backup_read_failed');
    if (stat.size > BACKUP_CONTAINER_MAX_BYTES) throw new Error('backup_too_large');
    const prefix = Buffer.alloc(magic.length);
    const { bytesRead } = await file.read(prefix, 0, prefix.length, null); guard();
    if (bytesRead !== magic.length || !prefix.equals(magic)) {
      await file.close(); file = undefined; guard();
      const document = await readBackupFile(path); guard();
      if ((document as any)?.version === 4) throw new Error('backup_invalid');
      return { document };
    }
    const length = (await exact(file, 4, guard)).readUInt32BE();
    if (length > BACKUP_MAX_BYTES) throw new Error('backup_too_large');
    let parsed: unknown;
    try { parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await exact(file, length, guard))); }
    catch (error) { guard(); throw new Error(error instanceof Error && error.message === 'backup_stale' ? 'backup_stale' : 'backup_invalid'); }
    const document = validateContainerManifest(parsed);
    const expectedSize = magic.length + 4 + length + document.payloads!.reduce((n, p) => n + p.size, 0);
    if (expectedSize !== stat.size) throw new Error('backup_invalid');
    const root = options.stagingRoot ?? tmpdir();
    await mkdir(root, { recursive: true }); guard();
    const directory = await mkdtemp(join(root, 'polyask-backup-stage-'));
    staging = new BackupStaging(document, directory); options.onStage?.(staging); guard();
    const sets = new Map(document.entries.filter(e => e.kind === 'questionAttachments').map(e => [e.id, attachmentBody(e)]));
    for (const [index, payload] of document.payloads!.entries()) {
      const bytes = await exact(file, payload.size, guard);
      verifyQuestionImage(sets.get(payload.setId)!.images[payload.index], bytes);
      const output = await open(staging.path(index), 'wx', 0o600);
      try { guard(); await write(output, bytes, guard); } finally { await output.close(); }
      guard();
    }
    const tail = await file.read(Buffer.alloc(1), 0, 1, null); guard();
    if (tail.bytesRead) throw new Error('backup_invalid');
    return { document, staging };
  } catch (error) {
    staging?.dispose();
    if (error instanceof Error && error.message.startsWith('backup_')) throw error;
    throw new Error(error instanceof Error && error.message === 'invalid_question_attachments' ? 'backup_invalid' : 'backup_read_failed');
  } finally { await file?.close(); }
}
export async function writeBackupContainer(path: string, value: BackupDocument,
  read: (entry: BackupEntry) => readonly Buffer[], guard: BackupGuard = noop, beforeCommit: BackupGuard = guard): Promise<void> {
  const document = validateContainerManifest(value);
  const manifest = Buffer.from(JSON.stringify(document), 'utf8');
  const length = Buffer.alloc(4); length.writeUInt32BE(manifest.length);
  const temporary = `${path}.${randomUUID()}.tmp`;
  let file: File | undefined;
  try {
    guard(); file = await open(temporary, 'wx', 0o600); guard();
    await write(file, magic, guard); await write(file, length, guard); await write(file, manifest, guard);
    for (const entry of document.entries.filter(e => e.kind === 'questionAttachments')) {
      guard();
      const bytes = read(entry), body = attachmentBody(entry);
      if (bytes.length !== body.images.length) throw new Error('backup_invalid');
      for (const [index, payload] of bytes.entries()) {
        verifyQuestionImage(body.images[index], payload);
        await write(file, payload, guard);
      }
    }
    guard(); await file.sync(); guard(); await file.close(); file = undefined; guard();
    // Synchronous rename makes the final intent check and publication indivisible to JS callbacks.
    // Async rename could complete after reset/cancel has already returned.
    beforeCommit(); renameSync(temporary, path);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('backup_')) throw error;
    throw new Error('backup_write_failed');
  } finally { await file?.close(); await unlink(temporary).catch(() => {}); }
}
