import type { FolderTarget } from '../shared/task-folder';

export interface BulkRequest {
  readonly targets: readonly FolderTarget[];
  readonly action: 'add-folder' | 'favorite' | 'export';
  readonly folderIds?: readonly string[];
  readonly favorite?: boolean;
  readonly locale: string;
}
export interface BulkDocument { readonly target: FolderTarget; readonly markdown: string }
export interface BulkOutcome {
  readonly succeeded: readonly FolderTarget[];
  readonly failed: readonly FolderTarget[];
  readonly stopped: readonly FolderTarget[];
  readonly documents: readonly BulkDocument[];
}
export interface BulkApi {
  perform(target: FolderTarget, request: BulkRequest): Promise<string | void>;
  progress?(done: number): void;
}
export const targetKey = (target: FolderTarget) => `${target.kind}:${target.id}`;

// 单目标请求串行执行；停止只阻止下一项，不把当前写入误报为取消。
export async function runLibraryBulk(request: BulkRequest, api: BulkApi, shouldStop: () => boolean): Promise<BulkOutcome> {
  const succeeded: FolderTarget[] = [], failed: FolderTarget[] = [], stopped: FolderTarget[] = [];
  const documents: BulkDocument[] = [];
  for (let index = 0; index < request.targets.length; index++) {
    if (shouldStop()) { stopped.push(...request.targets.slice(index)); break; }
    const target = request.targets[index];
    try {
      const markdown = await api.perform(target, request);
      succeeded.push(target);
      if (request.action === 'export' && typeof markdown === 'string') documents.push({ target, markdown });
    } catch { failed.push(target); }
    if (!shouldStop()) api.progress?.(succeeded.length + failed.length);
  }
  return { succeeded, failed, stopped, documents };
}

export function mergeBulkOutcomes(previous: BulkOutcome, next: BulkOutcome, retried: readonly FolderTarget[]): BulkOutcome {
  const keys = new Set(retried.map(targetKey));
  return { succeeded: [...previous.succeeded, ...next.succeeded],
    failed: [...previous.failed.filter(target => !keys.has(targetKey(target))), ...next.failed],
    stopped: [...previous.stopped, ...next.stopped], documents: [...previous.documents, ...next.documents] };
}

export function bulkMarkdown(request: BulkRequest, outcome: BulkOutcome): string | null {
  if (outcome.failed.length || outcome.stopped.length || outcome.succeeded.length !== request.targets.length) return null;
  const documents = new Map(outcome.documents.map(document => [targetKey(document.target), document.markdown]));
  if (request.targets.some(target => !documents.has(targetKey(target)))) return null;
  return request.targets.map(target => documents.get(targetKey(target))!).join('\n\n---\n\n');
}
