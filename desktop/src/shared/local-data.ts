/** 分类计数对应既有 clear 返回口径；reset 子计数包含孤立活动记录。 */
export interface LocalDataStats {
  readonly history: number;
  readonly archives: number;
  readonly decisions: number;
  readonly folders: number;
  readonly answers: number;
  readonly memberships: number;
  readonly reset: {
    readonly answers: number;
    readonly memberships: number;
    readonly templates: number;
    readonly groups: number;
    readonly workspace: 0 | 1;
  };
}

export function isLocalDataStats(value: unknown): value is LocalDataStats {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  const count = (entry: unknown) => typeof entry === 'number' && Number.isSafeInteger(entry) && entry >= 0;
  if (!['history', 'archives', 'decisions', 'folders', 'answers', 'memberships'].every(key => count(item[key]))) return false;
  if (!item.reset || typeof item.reset !== 'object' || Array.isArray(item.reset)) return false;
  const reset = item.reset as Record<string, unknown>;
  return ['answers', 'memberships', 'templates', 'groups'].every(key => count(reset[key]))
    && (reset.workspace === 0 || reset.workspace === 1);
}
