import type { ArchiveRecord } from "../shared/archive";
import type { Tier } from "../shared/protocol";

export interface SynthesisDraft {
  readonly selectedHosts: readonly string[];
  readonly targetSite: string;
  readonly tier: Tier;
  readonly instruction: string;
  readonly excerpt: string;
}
export interface SynthesisDraftStore {
  save(record: ArchiveRecord, draft: SynthesisDraft, followUpHost?: string): void;
  restore(record: ArchiveRecord, followUpHost?: string): (SynthesisDraft & { readonly sourceChanged: boolean; readonly sourceUpdatedAt?: number }) | null;
  version(archiveId: string, followUpHost?: string): number | null;
  remove(archiveId: string, followUpHost?: string, expectedVersion?: number | null): void;
  clear(): void;
  review(record: ArchiveRecord, followUpHost?: string): void;
}

/** 会话缓存保留来源核对；独立持久化与恢复由编辑器的草稿 hook 负责。 */
export function createSynthesisDraftStore(): SynthesisDraftStore {
  const entries = new Map<string, { record: ArchiveRecord; currentRecord: ArchiveRecord; draft: SynthesisDraft; version: number }>();
  let version = 0;
  const key = (archiveId: string, followUpHost?: string) => JSON.stringify([archiveId, followUpHost ?? null]);
  return {
    save(record, draft, followUpHost) {
      const id = key(record.id, followUpHost);
      const previous = entries.get(id);
      const unchanged = previous && JSON.stringify(previous.draft) === JSON.stringify(draft)
        && draft.selectedHosts.every(host => previous.currentRecord.results.find(result => result.host === host)?.text
          === record.results.find(result => result.host === host)?.text);
      // 比较基线保留至成功发送或显式清空；组件重新保存不能抹掉来源变更提醒。
      entries.set(id, { record: previous?.record ?? record, currentRecord: record,
        draft: { ...draft, selectedHosts: [...draft.selectedHosts] }, version: unchanged ? previous.version : ++version });
    },
    restore(record, followUpHost) {
      const saved = entries.get(key(record.id, followUpHost));
      if (!saved) return null;
      const available = record.results.filter(result => !!result.text?.trim());
      const selectedHosts = saved.draft.selectedHosts.filter(host => available.some(result => result.host === host));
      const sourceChanged = saved.record.updatedAt !== record.updatedAt || saved.draft.selectedHosts.some(host =>
        saved.record.results.find(result => result.host === host)?.text !== available.find(result => result.host === host)?.text);
      return { ...saved.draft, selectedHosts, sourceChanged, sourceUpdatedAt: saved.record.updatedAt };
    },
    version(archiveId, followUpHost) { return entries.get(key(archiveId, followUpHost))?.version ?? null; },
    remove(archiveId, followUpHost, expectedVersion) {
      const id = key(archiveId, followUpHost);
      if (expectedVersion === undefined || (entries.get(id)?.version ?? null) === expectedVersion) entries.delete(id);
    },
    clear() { entries.clear(); },
    review(record, followUpHost) {
      const id = key(record.id, followUpHost), previous = entries.get(id);
      if (previous) entries.set(id, { ...previous, record, currentRecord: record, version: ++version });
    }
  };
}
