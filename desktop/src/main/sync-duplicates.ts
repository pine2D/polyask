import type { OutboxOperation } from "../shared/sync";
import type { SyncRepository } from "./sync-repository";

export interface DuplicateDrive {
  remove?(fileId: string, signal?: AbortSignal): Promise<void>;
}

/** Shared entity files any device may rewrite; per-device files are converged only by their writer. */
const SHARED_KINDS = new Set<OutboxOperation["kind"]>(["archive", "decision", "folder", "folderMembership", "question", "questionAnswer"]);

/**
 * A create whose response was lost (timeout, crash) leaves two Drive files for one logical key.
 * Every device keeps the smallest file id (the same one `findDriveFile` resolves to), deletes the
 * rest, and re-uploads its merged local winner into the keeper, so a deleted body cannot linger
 * in a stale copy. Failed deletions stay indexed and are retried on a later round.
 */
export async function convergeDuplicateFiles(repository: SyncRepository, drive: DuplicateDrive, signal: AbortSignal): Promise<void> {
  if (!drive.remove) return;
  const deviceId = repository.deviceId();
  const byKey = new Map<string, string[]>();
  for (const file of repository.driveFiles()) byKey.set(file.logicalKey, [...(byKey.get(file.logicalKey) ?? []), file.id]);
  for (const [key, ids] of byKey) {
    const operation = rewrite(key, deviceId);
    if (ids.length < 2 || !operation) continue;
    const [, ...extra] = [...ids].sort();
    let removed = false;
    for (const id of extra) {
      signal.throwIfAborted();
      try {
        await drive.remove(id, signal);
        repository.deleteDriveFile(id);
        removed = true;
      } catch (error) {
        if (signal.aborted) throw error;
      }
    }
    if (removed) repository.enqueue(operation);
  }
}

function rewrite(key: string, deviceId: string): OutboxOperation | null {
  if (key === `state:${deviceId}`) return { key: "state", kind: "state", nextAt: 0, attempt: 0 };
  const split = key.indexOf(":");
  const kind = key.slice(0, split) as OutboxOperation["kind"];
  if (split < 1 || !SHARED_KINDS.has(kind)) return null;
  return { key, kind, entityId: key.slice(split + 1), nextAt: 0, attempt: 0 };
}
