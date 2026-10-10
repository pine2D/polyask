import { useState } from 'react';
import type { DesktopCopy } from '../shared/copy';
import { validFolderName, type TaskFolder } from '../shared/task-folder';
import { FolderModal } from './folder-modal';
import { ConfirmDialog } from './confirm-dialog';
import { requestDecisionNavigation, runApprovedDecisionNavigation } from './decision-navigation';
import { shell } from './shell-api';
import { getLibraryCopy } from '../shared/library-scale-copy';

export function FolderSidebar({ copy, folders, selected, onSelect, onChanged, disabled = false, locale = 'en' }: {
  copy: DesktopCopy; folders: readonly TaskFolder[]; selected: string; onSelect: (id: string) => void; onChanged: () => void;
  disabled?: boolean; locale?: string;
}): React.JSX.Element {
  const labels = getLibraryCopy(locale);
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<TaskFolder | 'new' | null>(null);
  const [removing, setRemoving] = useState<TaskFolder | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const blocked = busy || disabled;
  const current = folders.find(folder => folder.id === selected);
  const edit = (folder: TaskFolder | 'new') => { setName(folder === 'new' ? '' : folder.name); setMessage(''); setEditing(folder); };
  const save = async () => {
    if (!editing || blocked) return;
    const trimmed = name.trim();
    if (!validFolderName(name)) { setMessage(copy.folderNameInvalid); return; }
    setBusy(true);
    try { if (editing === 'new') await shell.createFolder(trimmed); else await shell.renameFolder(editing.id, trimmed); setEditing(null); onChanged(); }
    catch { setMessage(copy.folderFailed); } finally { setBusy(false); }
  };
  return <aside className="folder-sidebar" aria-label={copy.folderTitle}>
    <strong>{copy.folderTitle}</strong>
    <input type="search" name="library-folder-search" aria-label={labels.folderSearch} placeholder={`${labels.folderSearch}…`} autoComplete="off" value={query} disabled={blocked} onChange={event => setQuery(event.target.value)} />
    <nav>{[{ id: '', name: copy.folderAll }, { id: '__unfiled__', name: copy.folderUnfiled },
      ...folders.filter(folder => folder.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()))].map(folder => {
      const count = 'contentCount' in folder && typeof folder.contentCount === 'number' && Number.isSafeInteger(folder.contentCount) && folder.contentCount >= 0 ? folder.contentCount : null;
      return <button key={folder.id} aria-current={selected === folder.id ? 'page' : undefined} disabled={blocked} onClick={() => onSelect(folder.id)}>
        <span className="library-folder-name">{folder.name}</span>{folder.id && folder.id !== '__unfiled__' ? <span className="library-folder-count" title={count === null ? labels.folderCountUnknown : undefined} aria-label={count === null ? labels.folderCountUnknown : undefined}>{count ?? '—'}</span> : null}
      </button>;
    })}</nav>
    <button disabled={blocked} onClick={() => edit('new')}>＋ {copy.folderNew}</button>
    {current ? <div className="folder-manage"><button disabled={blocked} onClick={() => edit(current)}>{copy.folderRename}</button><button disabled={blocked} onClick={() => setRemoving(current)}>{copy.folderDelete}</button></div> : null}
    {!editing && message ? <p role="status">{message}</p> : null}
    {editing ? <FolderModal copy={copy} title={editing === 'new' ? copy.folderNew : copy.folderRename} busy={blocked} onCancel={() => setEditing(null)}>
      <label>{copy.folderName}<input value={name} disabled={blocked} onChange={event => setName(event.target.value)} onKeyDown={event => {
        if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
        if (event.key === 'Enter') { event.preventDefault(); void save(); }
      }} /></label>
      <p role="status">{message}</p><div className="confirm-actions"><button disabled={blocked} onClick={() => setEditing(null)}>{copy.cancel}</button><button disabled={blocked} className="primary" onClick={() => void save()}>{copy.decisionSave}</button></div>
    </FolderModal> : null}
    {removing ? <ConfirmDialog copy={copy} title={copy.folderDelete} message={copy.folderDeleteConfirm} confirmLabel={copy.decisionConfirm} cancelLabel={copy.cancel} onCancel={() => setRemoving(null)} onConfirm={() => {
      if (blocked) return;
      const id = removing.id; setRemoving(null); requestDecisionNavigation(() => { setBusy(true);
      shell.deleteFolder(id).then(() => { runApprovedDecisionNavigation(() => onSelect('')); onChanged(); }).catch(() => setMessage(copy.folderFailed)).finally(() => setBusy(false)); });
    }} /> : null}
  </aside>;
}
