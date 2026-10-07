import type { DesktopCopy } from '../shared/copy';
import { formatCopy } from '../shared/copy';
import type { LibraryCopy } from '../shared/library-scale-copy';
import { formatDateTime } from '../shared/format';
import type { FolderContent } from '../shared/task-folder';
import { decisionStatusLabel } from './decision-editor';
import { libraryTitle } from './library-list-model';
import { StarIcon } from './icons';

export function LibraryContentRow({ item, copy, labels, locale, current, checked, disabled, onCheck, onOpen }: {
  item: FolderContent; copy: DesktopCopy; labels: LibraryCopy; locale: string;
  current: boolean; checked: boolean; disabled: boolean; onCheck: () => void; onOpen: () => void;
}) {
  const title = libraryTitle(item), time = item.kind === 'archive' ? item.record.ts : item.record.updatedAt;
  return <div className="library-content-row">
    <label className="library-row-check"><input type="checkbox" checked={checked} disabled={disabled}
      aria-label={formatCopy(labels.selectItem, { title: title || '—' })} onChange={onCheck} /></label>
    <button type="button" data-action="library-open-item" aria-current={current ? 'true' : undefined} disabled={disabled} onClick={onOpen}>
      <span className="library-item-type">{item.kind === 'archive' ? copy.libraryResults : copy.libraryCards}
        {item.kind === 'archive' && item.record.favorite ? <StarIcon /> : null}
        {item.kind === 'decision' ? <span className="library-status-badge" data-status={item.record.status}>{decisionStatusLabel(copy, item.record.status)}</span> : null}
      </span>
      <span className="library-item-title" title={title}>{title || '—'}</span>
      {item.kind === 'archive' ? <small title={item.record.results.map(result => result.label).join(', ')}>{item.record.results.map(result => result.label).join(' / ')}</small> : null}
      <time dateTime={new Date(time).toISOString()}>{formatDateTime(time, locale)}</time>
      {item.kind === 'archive' && item.record.tags.length ? <span className="library-item-tags">{item.record.tags.slice(0, 2).map(tag => <i key={tag}>{tag}</i>)}{item.record.tags.length > 2 ? <i>+{item.record.tags.length - 2}</i> : null}</span> : null}
    </button>
  </div>;
}
