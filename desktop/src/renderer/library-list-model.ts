import type { FolderContent } from '../shared/task-folder';
import { resolveLocale } from '../shared/locale';

export type LibrarySort = 'updated-desc' | 'created-desc' | 'title-asc';
export const LIBRARY_PAGE_SIZE = 100;
export const contentKey = (item: FolderContent) => `${item.kind}:${item.record.id}`;
export const libraryTitle = (item: FolderContent) => item.kind === 'archive'
  ? item.record.task || item.record.preview : item.record.title;

export function sortLibraryContents(items: readonly FolderContent[], sort: LibrarySort, locale: string): readonly FolderContent[] {
  const language = resolveLocale(locale);
  const collator = new Intl.Collator(language === 'zhCN' ? 'zh-CN' : language === 'zhTW' ? 'zh-TW' : 'en', { sensitivity: 'base', numeric: true });
  return [...items].sort((left, right) => {
    const order = sort === 'title-asc' ? collator.compare(libraryTitle(left), libraryTitle(right))
      : sort === 'created-desc' ? right.record.createdAt - left.record.createdAt : right.record.updatedAt - left.record.updatedAt;
    return order || left.record.id.localeCompare(right.record.id) || left.kind.localeCompare(right.kind);
  });
}

export function pageLibraryContents(items: readonly FolderContent[], requestedPage: number) {
  const pageCount = Math.max(1, Math.ceil(items.length / LIBRARY_PAGE_SIZE));
  const page = Math.max(0, Math.min(pageCount - 1, Number.isFinite(requestedPage) ? Math.floor(requestedPage) : 0));
  const offset = page * LIBRARY_PAGE_SIZE;
  return { items: items.slice(offset, offset + LIBRARY_PAGE_SIZE), page, pageCount,
    start: items.length ? offset + 1 : 0, end: Math.min(offset + LIBRARY_PAGE_SIZE, items.length), total: items.length };
}
