import type { ArchiveRecord } from './archive';
import type { DecisionRecord } from './decision';
import type { FolderFilters, FolderTarget } from './task-folder';

export type FolderSort = 'updated-desc' | 'created-desc' | 'title-asc';
export const FOLDER_PAGE_SIZE = 100;
/** 本机只读投影：不保存正文、不改变同步或备份格式。 */
export type FolderContentSummary = {
  readonly kind: 'archive';
  readonly record: Pick<ArchiveRecord, 'id' | 'task' | 'preview' | 'ts' | 'tags' | 'favorite' | 'createdAt' | 'updatedAt'> & {
    readonly results: readonly { readonly label: string }[];
  };
} | {
  readonly kind: 'decision';
  readonly record: Pick<DecisionRecord, 'id' | 'title' | 'status' | 'createdAt' | 'updatedAt'>;
};
export interface FolderPageRequest extends FolderFilters {
  readonly page?: number;
  readonly sort?: FolderSort;
  readonly locale?: string;
  readonly selected?: FolderTarget;
  readonly selectedTargets?: readonly FolderTarget[];
  readonly locateSelected?: boolean;
}
export interface FolderContentPage {
  readonly items: readonly FolderContentSummary[];
  readonly total: number;
  readonly page: number;
  readonly selected: FolderTarget | null;
  readonly selectedPage: number | null;
  readonly selectedTargets: readonly FolderTarget[];
}
