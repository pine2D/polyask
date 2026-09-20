import { useEffect, useState } from 'react';
import { formatCopy } from "../shared/copy";
import type { DesktopCopy } from '../shared/copy';
import type { FolderMembershipChange, FolderTarget, TaskFolder } from '../shared/task-folder';
import { FolderModal } from './folder-modal';
import { shell } from './shell-api';

export function membershipChanges(before: readonly string[], after: readonly string[]): FolderMembershipChange[] {
  const old = new Set(before), next = new Set(after);
  return [...new Set([...before, ...after])].filter(id => old.has(id) !== next.has(id)).map(folderId => ({ folderId, present: next.has(folderId) }));
}
export function FolderMembershipDialog({ copy, target, folders, onCancel, onSaved }: {
  copy: DesktopCopy; target: FolderTarget; folders: readonly TaskFolder[]; onCancel: () => void; onSaved: () => void;
}): React.JSX.Element {
  const [original, setOriginal] = useState<string[] | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [query, setQuery] = useState('');
  const visibleFolders = folders.filter(folder => folder.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    shell.folderMemberships(target).then(ids => { if (active) { setOriginal(ids); setSelected(ids); setMessage(''); } })
      .catch(() => { if (active) setMessage(copy.folderLoadFailed); });
    return () => { active = false; };
  }, [target.id, target.kind, retry, copy.folderLoadFailed]);
  const save = async () => {
    if (!original || busy) return;
    setBusy(true); setMessage('');
    try { const changes = membershipChanges(original, selected); if (changes.length) await shell.patchFolderMemberships(target, changes); onSaved(); }
    catch { setMessage(copy.folderFailed); } finally { setBusy(false); }
  };
  return <FolderModal copy={copy} title={copy.folderMembership} busy={busy} onCancel={onCancel}>
    <p>{copy.folderMembershipHint}</p>
    <input type="search" name="folder-membership-search" autoComplete="off" aria-label={copy.librarySearchFolders} placeholder={`${copy.librarySearchFolders}…`} value={query} disabled={busy} onChange={event => setQuery(event.target.value)} />
    <p className="library-selection-count">{formatCopy(copy.librarySelected, { count: selected.length })}</p>
    {!original ? <button onClick={() => setRetry(value => value + 1)}>{message ? copy.retryShellLoad : copy.archiveLoading}</button> : folders.length ? <div className="folder-checkboxes">{visibleFolders.map(folder => <label key={folder.id}><input type="checkbox" disabled={busy} checked={selected.includes(folder.id)} onChange={event => setSelected(ids => event.target.checked ? [...ids, folder.id] : ids.filter(id => id !== folder.id))} />{folder.name}</label>)}{!visibleFolders.length ? <p>{copy.archiveNoMatches}</p> : null}</div> : <p>{copy.folderNoFolders}</p>}
    <p role="status">{message}</p><div className="confirm-actions"><button disabled={busy} onClick={onCancel}>{copy.cancel}</button><button className="primary" disabled={!original || busy} onClick={() => void save()}>{copy.decisionSave}</button></div>
  </FolderModal>;
}
