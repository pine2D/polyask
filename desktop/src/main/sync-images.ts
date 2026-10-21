import { MAX_IMAGE_BYTES } from '../shared/images';
import { isStoredQuestionAttachments } from '../shared/question-attachments';
import { questionIdValid } from '../shared/question-history';
import type { DriveFile } from './drive-client';
import { questionAttachmentId } from './question-attachment-repository';
import { imageWireId } from './sync-image-store';
import type { SyncDrive } from './sync-engine';
import type { SyncRepository } from './sync-repository';

const LOCAL_FAILURES = new Set(['request_failed', 'invalid_response', 'not_found', 'network_error', 'network_timeout', 'server_error']);
/** Image requests have an independent generation so opting out never aborts text synchronization. */
export class SyncImages {
  private generation = 0;
  private readonly active = new Set<AbortController>();
  constructor(private readonly repository: SyncRepository, private readonly drive: Pick<SyncDrive, 'download' | 'listFiles'>, private readonly now: () => number) {}
  cancel(): void { this.generation++; for (const controller of this.active) controller.abort(); }

  checkpoint(): () => boolean {
    const generation = this.generation, lifecycle = this.repository.imageLifecycle();
    return () => generation === this.generation && lifecycle === this.repository.imageLifecycle();
  }

  async transfer<T>(parent: AbortSignal, action: (signal: AbortSignal, current: () => boolean) => Promise<T>): Promise<boolean> {
    const checkpoint = this.checkpoint();
    const controller = new AbortController(); this.active.add(controller);
    const signal = AbortSignal.any([parent, controller.signal]);
    const current = () => !signal.aborted && checkpoint();
    let stop: () => void = () => {};
    const cancelled = new Promise<boolean>(resolve => { stop = () => resolve(false); signal.addEventListener('abort', stop, { once: true }); });
    try {
      signal.throwIfAborted();
      const done = action(signal, current).then(current);
      return await Promise.race([done, cancelled]);
    } catch (error) { if (signal.aborted) return false; throw error; }
    finally { signal.removeEventListener('abort', stop); this.active.delete(controller); }
  }

  async read(file: DriveFile, parent: AbortSignal): Promise<'valid' | 'skipped' | 'corrupt' | 'failed' | number> {
    const props = file.appProperties ?? {};
    if (!/^[a-f0-9]{64}$/.test(props.id ?? '') || !['0', '1'].includes(props.deleted)) return 'corrupt';
    const key = `questionAttachmentsHash:${props.id}`;
    // Unverified metadata remains discoverable after the changes token advances.
    this.repository.putDriveFile(file, key, 0);
    if (!this.repository.imageSyncEnabled() && props.deleted !== '1') return 'skipped';
    let result: 'valid' | 'skipped' | 'corrupt' | 'failed' | number = 'skipped';
    const lifecycle = this.repository.imageLifecycle();
    try {
      await this.transfer(parent, async (signal, current) => {
        const body = await this.drive.download(file.id, signal, 4 * Math.ceil(MAX_IMAGE_BYTES / 3) + 64 * 1024);
        signal.throwIfAborted();
        if (!current() || lifecycle !== this.repository.imageLifecycle()) return;
        if (body && typeof body === 'object' && Number((body as {schema?: unknown}).schema) > 5) {
          result = Number((body as {schema: unknown}).schema); return;
        }
        if (!isStoredQuestionAttachments(body) || imageWireId(body.id) !== props.id ||
          ('deletedAt' in body) !== (props.deleted === '1')) { result = 'corrupt'; return; }
        if (!('deletedAt' in body) && !this.repository.imageSyncEnabled()) return;
        if (!this.repository.importQuestionAttachments(body)) { result = 'corrupt'; return; }
        this.repository.putDriveFile(file, `questionAttachments:${body.id}`, this.now());
        result = 'valid';
      });
    } catch (error) {
      if (!LOCAL_FAILURES.has((error as { code?: string }).code ?? '')) throw error;
      result = 'failed';
      if ((error as { code?: string }).code === 'not_found') this.repository.deleteDriveFile(file.id);
    }
    return result;
  }

  async fetch(questionId: string): Promise<boolean> {
    if (!questionIdValid(questionId) || !this.repository.config().connected || !this.repository.imageSyncEnabled()) return false;
    const parent = this.repository.question(questionId);
    if (!parent || 'deletedAt' in parent || parent.inputImageCount === 0) return false;
    const id = questionAttachmentId(questionId), hash = imageWireId(id), lifecycle = this.repository.imageLifecycle();
    const current = () => {
      const value = this.repository.question(questionId);
      return lifecycle === this.repository.imageLifecycle() && this.repository.config().connected &&
        this.repository.imageSyncEnabled() && !!value && !('deletedAt' in value);
    };
    const manifest = this.repository.imageManifest(id);
    if (manifest && 'deletedAt' in manifest) return false;
    let success = false;
    await this.transfer(new AbortController().signal, async (signal, transferCurrent) => {
      const files = await this.drive.listFiles(signal);
      signal.throwIfAborted(); if (!transferCurrent() || !current()) return;
      for (const file of files) {
        if (file.appProperties?.app !== 'polyask' || file.appProperties.kind !== 'questionAttachments' ||
          file.appProperties.id !== hash) continue;
        const schema = Number(file.appProperties.schema);
        if (schema > 5) { this.rememberFuture(file.id, schema); continue; }
        if (schema !== 5) continue;
        const result = await this.read(file, signal);
        signal.throwIfAborted(); if (!transferCurrent() || !current()) return;
        if (typeof result === 'number') this.rememberFuture(file.id, result);
      }
      const value = this.repository.questionAttachments(id);
      success = !!value && !('deletedAt' in value) && current();
    });
    return success && current();
  }

  private rememberFuture(fileId: string, schema: number): void {
    this.repository.deleteDriveFile(fileId);
    this.repository.saveConfig({ readOnly: true,
      futureFiles: { ...this.repository.config().futureFiles, [fileId]: schema } });
  }
}
