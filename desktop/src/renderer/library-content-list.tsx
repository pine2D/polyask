import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { DesktopCopy } from '../shared/copy';
import { formatCopy } from '../shared/copy';
import { getLibraryCopy } from '../shared/library-scale-copy';
import type { FolderFilters } from '../shared/task-folder';
import type { FolderContentPage, FolderContentSummary } from '../shared/task-folder-page';
import { decisionStatuses, decisionStatusLabel } from './decision-editor';
import { LibrarySelect } from './library-select';
import { StarIcon } from './icons';
import { LIBRARY_PAGE_SIZE, pageLibraryContents, sortLibraryContents, type LibrarySort } from './library-list-model';
import { matchingSelection, selectLibraryPage, toggleLibrarySelection } from './library-selection';
import { LibraryContentRow } from './library-content-row';

export function LibraryContentList<T extends FolderContentSummary>({ copy, locale, items, filters, tags, loading, failed, selectedKey, onChange, onSelect, onRetry,
  page: controlledPage, sort: controlledSort, selectedKeys: controlledKeys, onPageChange, onSortChange, onSelectedKeysChange, disabled = false, onScroll, listScroll = 0, serverPage }: {
  copy: DesktopCopy; locale: string; items: readonly T[]; filters: FolderFilters; tags: readonly string[];
  loading: boolean; failed: boolean; selectedKey: string | null; onChange: (patch: Partial<FolderFilters>) => void;
  onSelect: (item: T) => void; onRetry: () => void;
  page?: number; sort?: LibrarySort; selectedKeys?: readonly string[]; disabled?: boolean;
  onPageChange?: (page: number) => void; onSortChange?: (sort: LibrarySort) => void;
  onSelectedKeysChange?: (keys: readonly string[]) => void; onScroll?: (scroll: number) => void; listScroll?: number;
  serverPage?: Pick<FolderContentPage, 'total' | 'page'>;
}): React.JSX.Element {
  const labels = getLibraryCopy(locale);
  const [ownPage, setOwnPage] = useState(0), [ownSort, setOwnSort] = useState<LibrarySort>('updated-desc');
  const [ownKeys, setOwnKeys] = useState<readonly string[]>([]);
  const page = controlledPage ?? ownPage, sort = controlledSort ?? ownSort, keys = controlledKeys ?? ownKeys;
  const setPage = onPageChange ?? setOwnPage, setSort = onSortChange ?? setOwnSort, setKeys = onSelectedKeysChange ?? setOwnKeys;
  const sorted = useMemo(() => serverPage ? items : sortLibraryContents(items, sort, locale), [items, sort, locale, serverPage]);
  const checkedKeys = useMemo(() => new Set(keys), [keys]);
  const current = serverPage ? { items, page: serverPage.page, total: serverPage.total,
    pageCount: Math.max(1, Math.ceil(serverPage.total / LIBRARY_PAGE_SIZE)),
    start: serverPage.total ? serverPage.page * LIBRARY_PAGE_SIZE + 1 : 0,
    end: Math.min((serverPage.page + 1) * LIBRARY_PAGE_SIZE, serverPage.total) } : pageLibraryContents(sorted, page);
  const unavailable = disabled || loading || failed;
  const scroller = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!loading && !failed && scroller.current) scroller.current.scrollTop = listScroll;
  }, [current.page, loading, failed]);
  useEffect(() => {
    if (loading || failed) return;
    if (!serverPage) {
      const next = matchingSelection(keys, items);
      if (next.length !== keys.length) setKeys(next);
    }
    if (current.page !== page) setPage(current.page);
  }, [items, loading, failed, keys, page, current.page, setKeys, setPage, serverPage]);
  const filtered = !!(filters.query || filters.tag || filters.favorite || filters.status);
  return <section className="folder-content-list" aria-label={copy.folderAll}>
    <div className="folder-filters">
      <input type="search" name="library-search" autoComplete="off" aria-label={copy.folderSearch} placeholder={`${copy.folderSearch}…`}
        disabled={disabled} value={filters.query ?? ''} onChange={event => onChange({ query: event.target.value })} />
      <div className="library-segments" role="group" aria-label={copy.folderKind}>
        {[['', copy.libraryAll], ['archive', copy.libraryResults], ['decision', copy.libraryCards]].map(([kind, label]) =>
          <button key={kind} type="button" disabled={disabled} aria-pressed={(filters.kind ?? '') === kind} onClick={() => onChange({ kind: kind as FolderFilters['kind'] })}>{label}</button>)}
      </div>
      <div className="library-filter-row">
        {filters.kind !== 'decision' ? <>
          <LibrarySelect disabled={disabled} label={copy.archiveTags} value={filters.tag ?? ''} searchLabel={copy.librarySearchOptions} emptyLabel={copy.archiveNoMatches}
            options={[{ value: '', label: copy.allArchiveTags }, ...tags.map(tag => ({ value: tag, label: tag }))]} onChange={tag => onChange({ tag })} />
          <button className="library-favorite" type="button" aria-label={copy.favoriteArchives} title={copy.favoriteArchives}
            disabled={disabled} aria-pressed={!!filters.favorite} onClick={() => onChange({ favorite: !filters.favorite })}><StarIcon /></button>
        </> : null}
        {filters.kind !== 'archive' ? <LibrarySelect disabled={disabled} label={copy.decisionStatus} value={filters.status ?? ''}
          options={[{ value: '', label: copy.decisionAll }, ...decisionStatuses.map(status => ({ value: status, label: decisionStatusLabel(copy, status) }))]}
          onChange={status => onChange({ status: status as FolderFilters['status'] })} /> : null}
      </div>
      <div className="library-list-summary"><span>{formatCopy(copy.libraryItemCount, { count: current.total })}</span>
        {filtered ? <button type="button" disabled={disabled} onClick={() => onChange({ query: '', tag: '', favorite: false, status: '' })}>{copy.libraryClearFilters}</button> : null}
      </div>
      <LibrarySelect name="library-sort" label={labels.sort} value={sort} disabled={unavailable}
        options={[{ value: 'updated-desc', label: labels.updated }, { value: 'created-desc', label: labels.created }, { value: 'title-asc', label: labels.title }]}
        onChange={value => { setSort(value as LibrarySort); if (!onSortChange) setPage(0); }} />
      <div className="library-selection-summary" role="status">{formatCopy(labels.selected, { count: keys.length, total: current.total })}</div>
      <div className="library-selection-controls">
        <button type="button" data-action="library-select-page" disabled={unavailable || !current.items.length} onClick={() => setKeys(selectLibraryPage(keys, current.items))}>{labels.selectPage}</button>
        <button type="button" data-action="library-clear-selection" disabled={unavailable || !keys.length} onClick={() => setKeys([])}>{labels.clearSelection}</button>
      </div>
    </div>
    <div ref={scroller} className="archive-list" aria-busy={loading} onScroll={event => onScroll?.(event.currentTarget.scrollTop)}>
      {failed ? <div className="library-empty" role="status"><p>{copy.folderLoadFailed}</p><button onClick={onRetry}>{copy.retryShellLoad}</button></div>
        : loading ? <div className="library-empty" role="status">{copy.archiveLoading}</div>
        : !items.length ? <div className="library-empty"><p>{filtered ? copy.archiveNoMatches : copy.folderEmpty}</p><small>{filtered ? copy.libraryClearFilters : copy.libraryEmptyHint}</small></div>
        : current.items.map(item => {
          const key = `${item.kind}:${item.record.id}`;
          return <LibraryContentRow key={key} item={item} copy={copy} labels={labels} locale={locale}
            current={selectedKey === key} checked={checkedKeys.has(key)} disabled={unavailable}
            onCheck={() => setKeys(toggleLibrarySelection(keys, key))} onOpen={() => onSelect(item)} />;
        })}
    </div>
    <nav className="library-pagination" aria-label={labels.page}>
      <span>{formatCopy(labels.range, { start: current.start, end: current.end, total: current.total })}</span>
      <div><button type="button" data-action="library-previous-page" aria-label={labels.previous} disabled={unavailable || !items.length || current.page === 0} onClick={() => setPage(current.page - 1)}>‹</button>
        <LibrarySelect name="library-page" label={labels.page} value={String(current.page)} disabled={unavailable || !items.length}
          options={Array.from({ length: current.pageCount }, (_, index) => ({ value: String(index), label: `${index + 1} / ${current.pageCount}` }))} onChange={value => setPage(Number(value))} />
        <button type="button" data-action="library-next-page" aria-label={labels.next} disabled={unavailable || !items.length || current.page + 1 >= current.pageCount} onClick={() => setPage(current.page + 1)}>›</button></div>
    </nav>
  </section>;
}
