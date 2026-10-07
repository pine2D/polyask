import type { FolderFilters } from '../shared/task-folder';
import type { ArchiveReaderState } from './archive-reader-session';
import type { LibrarySort } from './library-list-model';
export type { LibrarySort } from './library-list-model';

export interface LibrarySessionSnapshot {
  readonly filters: FolderFilters;
  readonly sort: LibrarySort;
  readonly page: number;
  readonly listScroll: number;
  readonly selectedKey: string | null;
  readonly pane: 'navigation' | 'list' | 'detail';
  readonly focused: boolean;
  readonly consumedNavigationKey: string | null;
  readonly reader: ArchiveReaderState | null;
}
export interface LibrarySessionStore {
  read(): Readonly<LibrarySessionSnapshot>;
  update(patch: Partial<LibrarySessionSnapshot>): void;
  clear(): void;
}
const initial = (): LibrarySessionSnapshot => ({ filters: { folderId: '' }, sort: 'updated-desc', page: 0,
  listScroll: 0, selectedKey: null, pane: 'list', focused: false, consumedNavigationKey: null, reader: null });

// 只保存当前会话的位置与ID；返回时重新读取记录，不缓存正文或危险确认。
export function createLibrarySessionStore(): LibrarySessionStore {
  let state = initial();
  return { read: () => state, update: patch => { state = { ...state, ...patch,
    ...('filters' in patch ? { filters: { ...patch.filters } } : {}) }; }, clear: () => { state = initial(); } };
}
