import { randomUUID } from 'node:crypto';
import { renameSync } from 'node:fs';
import { open, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';

/** 先写旁路文件；最后一次记录检查和 rename 同步相邻，不能插入删除或重置。 */
export async function writeReportFile(path: string, data: Uint8Array | string, guard: () => void): Promise<void> {
  guard();
  const temporary = join(dirname(path), `.polyask-report-${randomUUID()}.tmp`);
  let owned = false;
  try {
    const file = await open(temporary, 'wx', 0o600);
    owned = true;
    try {
      guard();
      await file.writeFile(data); guard();
      await file.sync(); guard();
    } finally { await file.close(); }
    guard();
    renameSync(temporary, path);
    owned = false;
  } finally {
    if (owned) await unlink(temporary);
  }
}
