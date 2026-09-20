import { open, rename, unlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { BACKUP_MAX_BYTES } from "../shared/backup";

export async function readBackupFile(path: string): Promise<unknown> {
  let file: Awaited<ReturnType<typeof open>> | undefined;
  try {
    file = await open(path, "r");
    const stat = await file.stat();
    if (!stat.isFile()) throw new Error("backup_read_failed");
    if (stat.size > BACKUP_MAX_BYTES) throw new Error("backup_too_large");
    // Bounded reads also cover a file growing after stat; never read an unbounded payload.
    const bytes = Buffer.alloc(BACKUP_MAX_BYTES + 1);
    let used = 0;
    while (used < bytes.length) {
      const { bytesRead } = await file.read(bytes, used, bytes.length - used, null);
      if (!bytesRead) break;
      used += bytesRead;
    }
    if (used > BACKUP_MAX_BYTES) throw new Error("backup_too_large");
    try { return JSON.parse(bytes.subarray(0, used).toString("utf8").replace(/^\uFEFF/u, "")); }
    catch { throw new Error("backup_invalid"); }
  } catch (error) {
    if (error instanceof Error && ["backup_too_large", "backup_invalid"].includes(error.message)) throw error;
    throw new Error("backup_read_failed");
  } finally { await file?.close(); }
}

export async function writeBackupFile(path: string, document: unknown): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    const text = `${JSON.stringify(document, null, 2)}\n`;
    if (Buffer.byteLength(text) > BACKUP_MAX_BYTES) throw new Error("backup_too_large");
    await writeFile(temporary, text, { encoding: "utf8", flag: "wx", mode: 0o600 });
    await rename(temporary, path);
  } catch (error) {
    if (error instanceof Error && error.message === "backup_too_large") throw error;
    throw new Error("backup_write_failed");
  } finally { await unlink(temporary).catch(() => {}); }
}
