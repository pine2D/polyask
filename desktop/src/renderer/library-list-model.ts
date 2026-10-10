import { FOLDER_PAGE_SIZE, type FolderContentSummary, type FolderSort } from '../shared/task-folder-page';
import { resolveLocale } from '../shared/locale';

export type LibrarySort = FolderSort;
export const LIBRARY_PAGE_SIZE = FOLDER_PAGE_SIZE;
export const contentKey = (item: FolderContentSummary) => `${item.kind}:${item.record.id}`;
export const libraryTitle = (item: FolderContentSummary) => item.kind === 'archive'
  ? item.record.task || item.record.preview : item.record.title;

export function sortLibraryContents<T extends FolderContentSummary>(items: readonly T[], sort: LibrarySort, locale: string): readonly T[] {
  const language = resolveLocale(locale);
  const collator = new Intl.Collator(language === 'zhCN' ? 'zh-CN' : language === 'zhTW' ? 'zh-TW' : 'en', { sensitivity: 'base', numeric: true });
  return [...items].sort((left, right) => {
    const order = sort === 'title-asc' ? collator.compare(libraryTitle(left), libraryTitle(right))
      : sort === 'created-desc' ? right.record.createdAt - left.record.createdAt : right.record.updatedAt - left.record.updatedAt;
    return order || left.record.id.localeCompare(right.record.id) || left.kind.localeCompare(right.kind);
  });
}

export function pageLibraryContents<T extends FolderContentSummary>(items: readonly T[], requestedPage: number) {
  const pageCount = Math.max(1, Math.ceil(items.length / LIBRARY_PAGE_SIZE));
  const page = Math.max(0, Math.min(pageCount - 1, Number.isFinite(requestedPage) ? Math.floor(requestedPage) : 0));
  const offset = page * LIBRARY_PAGE_SIZE;
  return { items: items.slice(offset, offset + LIBRARY_PAGE_SIZE), page, pageCount,
    start: items.length ? offset + 1 : 0, end: Math.min(offset + LIBRARY_PAGE_SIZE, items.length), total: items.length };
}
