import { createHash } from 'node:crypto';
import type { OutboxOperation } from '../shared/sync';
import type { DesktopDatabase } from './database';
export const imageWireId = (id: string): string => createHash('sha256').update(id).digest('hex');

/** Local-only opt-in and one eligibility predicate for pending, scheduling and upload selection. */
export class SyncImageStore {
  constructor(private readonly db: DesktopDatabase) {}
  enabled(): boolean { return this.db.meta.get('questionImageSyncEnabled') === true; }
  setEnabled(enabled: boolean): void {
    this.db.transaction(() => {
      this.db.meta.put('questionImageSyncEnabled', enabled);
      if (!enabled) return;
      this.db.meta.put('questionImageSyncAcknowledged', true);
      for (const value of this.db.questionAttachments.all()) {
        this.db.outbox.enqueue({ key: `questionAttachments:${value.id}`, kind: 'questionAttachments', entityId: value.id, nextAt: 0, attempt: 0 });
        const parent = this.db.questions.get(value.questionId);
        if (parent && !this.db.driveFiles.find(`question:${parent.id}`))
          this.db.outbox.enqueue({ key: `question:${parent.id}`, kind: 'question', entityId: parent.id, nextAt: 0, attempt: 0 });
      }
    });
  }

  selection(): (operation: OutboxOperation) => boolean {
    let remote: ReadonlySet<string> | undefined;
    return operation => this.eligible(operation, () => remote ??= this.remoteHashes());
  }
  private remoteHashes(): ReadonlySet<string> {
    return new Set(this.db.driveFiles.list().flatMap(file => file.appProperties?.kind === 'questionAttachments' ? file.appProperties.id : []));
  }
  eligible = (operation: OutboxOperation, remote: () => ReadonlySet<string> = () => this.remoteHashes()): boolean => {
    if (operation.kind !== 'questionAttachments') return true;
    if (!operation.entityId) return false;
    let value: ReturnType<DesktopDatabase['questionAttachments']['get']>;
    try { value = this.db.questionAttachments.get(operation.entityId); }
    catch { return this.enabled(); } // Enabled corrupt rows reach isolated projection failure/backoff, never a wire upload.
    if (!value) return false;
    if ('deletedAt' in value) {
      return this.db.meta.get('questionImageSyncAcknowledged') === true || remote().has(imageWireId(value.id));
    }
    const parent = this.db.questions.get(value.questionId);
    return this.enabled() && !!parent && !('deletedAt' in parent) &&
      !this.db.outbox.has(`question:${parent.id}`) && !!this.db.driveFiles.find(`question:${parent.id}`);
  };
}
