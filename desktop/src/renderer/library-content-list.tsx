import type { DesktopCopy } from '../shared/copy';
import { formatCopy } from '../shared/copy';
import { formatDateTime } from '../shared/format';
import type { FolderContent, FolderFilters } from '../shared/task-folder';
import { decisionStatuses, decisionStatusLabel } from './decision-editor';
import { LibrarySelect } from './library-select';
import { StarIcon } from './icons';

export function LibraryContentList({ copy, locale, items, filters, tags, loading, failed, selectedKey, onChange, onSelect, onRetry }: {
  copy: DesktopCopy; locale: string; items: readonly FolderContent[]; filters: FolderFilters; tags: readonly string[];
  loading: boolean; failed: boolean; selectedKey: string | null; onChange: (patch: Partial<FolderFilters>) => void;
  onSelect: (item: FolderContent) => void; onRetry: () => void;
}): React.JSX.Element {
  const filtered = !!(filters.query || filters.tag || filters.favorite || filters.status);
  return <section className="folder-content-list" aria-label={copy.folderAll}>
    <div className="folder-filters">
      <input type="search" name="library-search" autoComplete="off" aria-label={copy.folderSearch} placeholder={`${copy.folderSearch}…`}
        value={filters.query ?? ''} onChange={event => onChange({ query: event.target.value })} />
      <div className="library-segments" role="group" aria-label={copy.folderKind}>
        {[['', copy.libraryAll], ['archive', copy.libraryResults], ['decision', copy.libraryCards]].map(([kind, label]) =>
          <button key={kind} type="button" aria-pressed={(filters.kind ?? '') === kind} onClick={() => onChange({ kind: kind as FolderFilters['kind'] })}>{label}</button>)}
      </div>
      <div className="library-filter-row">
        {filters.kind !== 'decision' ? <>
          <LibrarySelect label={copy.archiveTags} value={filters.tag ?? ''} searchLabel={copy.librarySearchOptions} emptyLabel={copy.archiveNoMatches}
            options={[{ value: '', label: copy.allArchiveTags }, ...tags.map(tag => ({ value: tag, label: tag }))]} onChange={tag => onChange({ tag })} />
          <button className="library-favorite" type="button" aria-label={copy.favoriteArchives} title={copy.favoriteArchives}
            aria-pressed={!!filters.favorite} onClick={() => onChange({ favorite: !filters.favorite })}><StarIcon /></button>
        </> : null}
        {filters.kind !== 'archive' ? <LibrarySelect label={copy.decisionStatus} value={filters.status ?? ''}
          options={[{ value: '', label: copy.decisionAll }, ...decisionStatuses.map(status => ({ value: status, label: decisionStatusLabel(copy, status) }))]}
          onChange={status => onChange({ status: status as FolderFilters['status'] })} /> : null}
      </div>
      <div className="library-list-summary"><span>{formatCopy(copy.libraryItemCount, { count: items.length })}</span>
        {filtered ? <button type="button" onClick={() => onChange({ query: '', tag: '', favorite: false, status: '' })}>{copy.libraryClearFilters}</button> : null}
      </div>
    </div>
    <div className="archive-list" aria-busy={loading}>
      {failed ? <div className="library-empty" role="status"><p>{copy.folderLoadFailed}</p><button onClick={onRetry}>{copy.retryShellLoad}</button></div>
        : loading ? <div className="library-empty" role="status">{copy.archiveLoading}</div>
        : !items.length ? <div className="library-empty"><p>{filtered ? copy.archiveNoMatches : copy.folderEmpty}</p><small>{filtered ? copy.libraryClearFilters : copy.libraryEmptyHint}</small></div>
        : items.map(item => {
          const key = `${item.kind}:${item.record.id}`;
          const title = item.kind === 'archive' ? item.record.task || item.record.preview : item.record.title;
          const time = item.kind === 'archive' ? item.record.ts : item.record.updatedAt;
          return <button key={key} type="button" aria-current={selectedKey === key ? 'true' : undefined} onClick={() => onSelect(item)}>
            <span className="library-item-type">{item.kind === 'archive' ? copy.libraryResults : copy.libraryCards}
              {item.kind === 'archive' && item.record.favorite ? <StarIcon /> : null}
              {item.kind === 'decision' ? <span className="library-status-badge" data-status={item.record.status}>{decisionStatusLabel(copy, item.record.status)}</span> : null}
            </span>
            <span className="library-item-title" title={title}>{title || '—'}</span>
            {item.kind === 'archive' ? <small title={item.record.results.map(result => result.label).join(', ')}>{item.record.results.map(result => result.label).join(' / ')}</small> : null}
            <time dateTime={new Date(time).toISOString()}>{formatDateTime(time, locale)}</time>
            {item.kind === 'archive' && item.record.tags.length ? <span className="library-item-tags">{item.record.tags.slice(0, 2).map(tag => <i key={tag}>{tag}</i>)}{item.record.tags.length > 2 ? <i>+{item.record.tags.length - 2}</i> : null}</span> : null}
          </button>;
        })}
    </div>
  </section>;
}
