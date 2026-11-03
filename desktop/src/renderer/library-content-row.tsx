import type { DesktopCopy } from '../shared/copy';
import { formatCopy } from '../shared/copy';
import type { LibraryCopy } from '../shared/library-scale-copy';
import { dateTimeAttribute, formatDateTime, formatListDate } from '../shared/format';
import type { FolderContentSummary } from '../shared/task-folder-page';
import { decisionStatusLabel } from './decision-editor';
import { libraryTitle, type LibrarySort } from './library-list-model';
import { StarIcon } from './icons';

export function LibraryContentRow({ item, copy, labels, locale, current, checked, disabled, onCheck, onOpen, showKind = true, sort = 'updated-desc' }: {
  item: FolderContentSummary; copy: DesktopCopy; labels: LibraryCopy; locale: string;
  showKind?: boolean; sort?: LibrarySort;
  current: boolean; checked: boolean; disabled: boolean; onCheck: () => void; onOpen: () => void;
}) {
  const title = libraryTitle(item), time = sort === 'created-desc' ? item.record.createdAt : item.record.updatedAt;
  const instant = dateTimeAttribute(time), fullDate = instant ? formatDateTime(time, locale) : undefined;
  return <div className="library-content-row">
    <label className="library-row-check"><input type="checkbox" checked={checked} disabled={disabled}
      aria-label={formatCopy(labels.selectItem, { title: title || '—' })} onChange={onCheck} /></label>
    <button type="button" data-action="library-open-item" aria-current={current ? 'true' : undefined} disabled={disabled} onClick={onOpen}>
      <span className="library-item-heading">
        <span className="library-item-title" title={title}>{title || '—'}</span>
        {item.kind === 'archive' && item.record.favorite ? <span className="library-item-favorite" role="img" title={copy.libraryFavorited} aria-label={copy.libraryFavorited}><StarIcon /></span> : null}
      </span>
      <span className="library-item-meta">
        <time dateTime={instant} title={fullDate}>{formatListDate(time, locale)}</time>
        {item.kind === 'decision' ? <>
          {showKind && <span className="library-item-kind">{copy.libraryCards}</span>}
          <span className="library-status-badge" data-status={item.record.status}>{decisionStatusLabel(copy, item.record.status)}</span>
        </> : null}
      </span>
    </button>
  </div>;
}
