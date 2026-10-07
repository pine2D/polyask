import { useState } from 'react';
import type { DesktopCopy } from '../shared/copy';
import { formatCopy } from '../shared/copy';
import type { LibraryCopy } from '../shared/library-scale-copy';
import type { TaskFolder } from '../shared/task-folder';
import { FolderModal } from './folder-modal';

export function LibraryBulkFolderDialog({ copy, labels, folders, count, onCancel, onConfirm }: {
  copy: DesktopCopy; labels: LibraryCopy; folders: readonly TaskFolder[]; count: number;
  onCancel: () => void; onConfirm: (ids: readonly string[]) => void;
}) {
  const [ids, setIds] = useState<readonly string[]>([]);
  return <FolderModal copy={copy} title={labels.bulkAddFolder} busy={false} onCancel={onCancel}>
    <p>{formatCopy(labels.bulkScope, { count })}</p><p>{copy.folderMembershipHint}</p>
    {folders.length ? folders.map(folder => <label key={folder.id} className="library-bulk-folder-option">
      <input type="checkbox" name="library-bulk-folder" value={folder.id} checked={ids.includes(folder.id)}
        onChange={() => setIds(current => current.includes(folder.id) ? current.filter(id => id !== folder.id) : [...current, folder.id])} />{folder.name}
    </label>) : <p>{copy.folderEmpty}</p>}
    <div className="confirm-actions"><button type="button" onClick={onCancel}>{copy.cancel}</button>
      <button type="button" data-action="library-bulk-confirm-folders" disabled={!ids.length} onClick={() => onConfirm(ids)}>{labels.folderConfirm}</button></div>
  </FolderModal>;
}
