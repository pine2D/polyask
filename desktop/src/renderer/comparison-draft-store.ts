import type { ArchiveRecord } from '../shared/archive';
import { validateExcerpt } from './answer-excerpt';
import { COMPARISON_CATEGORIES, type ComparisonDraft } from './comparison-draft';

export interface ComparisonDraftStore {
  save(record: ArchiveRecord, draft: ComparisonDraft): number;
  restore(record: ArchiveRecord): { draft: ComparisonDraft; version: number; invalidHosts: readonly string[] } | null;
  remove(archiveId: string, expectedVersion?: number): void;
  clear(): void;
}
const clone = (draft: ComparisonDraft): ComparisonDraft => ({ ...draft, quotes: draft.quotes.map(value => ({ ...value })),
  categories: Object.fromEntries(Object.entries(draft.categories).map(([host, categories]) => [host, [...categories]])),
  notes: Object.fromEntries(COMPARISON_CATEGORIES.map(category => [category, { ...draft.notes[category] }])) as ComparisonDraft['notes'] });

/** 会话缓存保留表单位置；持久化与副本恢复由编辑器的草稿 hook 负责。 */
export function createComparisonDraftStore(): ComparisonDraftStore {
  const entries = new Map<string, { draft: ComparisonDraft; version: number }>();
  let version = 0;
  return {
    save(record, draft) {
      if (record.id !== draft.archiveId) throw new Error('comparison_source_mismatch');
      const previous = entries.get(record.id);
      const nextVersion = previous && JSON.stringify(previous.draft) === JSON.stringify(draft) ? previous.version : ++version;
      entries.set(record.id, { draft: clone(draft), version: nextVersion }); return nextVersion;
    },
    restore(record) {
      const entry = entries.get(record.id);
      return entry ? { draft: clone(entry.draft), version: entry.version,
        invalidHosts: [...new Set(entry.draft.quotes.filter(value => !validateExcerpt(record, value)).map(value => value.host))] } : null;
    },
    remove(id, expected) { if (expected === undefined || entries.get(id)?.version === expected) entries.delete(id); },
    clear() { entries.clear(); }
  };
}
