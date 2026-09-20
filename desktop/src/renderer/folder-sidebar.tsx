import { useState } from 'react';
import type { DesktopCopy } from '../shared/copy';
import { validFolderName, type TaskFolder } from '../shared/task-folder';
import { FolderModal } from './folder-modal';
import { ConfirmDialog } from './confirm-dialog';
import { requestDecisionNavigation, runApprovedDecisionNavigation } from './decision-navigation';
import { shell } from './shell-api';

export function FolderSidebar({ copy, folders, selected, onSelect, onChanged }: {
  copy: DesktopCopy; folders: readonly TaskFolder[]; selected: string; onSelect: (id: string) => void; onChanged: () => void;
}): React.JSX.Element {
  const [editing, setEditing] = useState<TaskFolder | 'new' | null>(null);
  const [removing, setRemoving] = useState<TaskFolder | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const current = folders.find(folder => folder.id === selected);
  const edit = (folder: TaskFolder | 'new') => { setName(folder === 'new' ? '' : folder.name); setMessage(''); setEditing(folder); };
  const save = async () => {
    if (!editing || busy) return;
    const trimmed = name.trim();
    if (!validFolderName(name)) { setMessage(copy.folderNameInvalid); return; }
    setBusy(true);
    try { if (editing === 'new') await shell.createFolder(trimmed); else await shell.renameFolder(editing.id, trimmed); setEditing(null); onChanged(); }
    catch { setMessage(copy.folderFailed); } finally { setBusy(false); }
  };
  return <aside className="folder-sidebar" aria-label={copy.folderTitle}>
    <strong>{copy.folderTitle}</strong>
    <nav>{[{ id: '', name: copy.folderAll }, { id: '__unfiled__', name: copy.folderUnfiled }, ...folders].map(folder => <button key={folder.id} aria-current={selected === folder.id ? 'page' : undefined} disabled={busy} onClick={() => onSelect(folder.id)}>{folder.name}</button>)}</nav>
    <button disabled={busy} onClick={() => edit('new')}>＋ {copy.folderNew}</button>
    {current ? <div className="folder-manage"><button disabled={busy} onClick={() => edit(current)}>{copy.folderRename}</button><button disabled={busy} onClick={() => setRemoving(current)}>{copy.folderDelete}</button></div> : null}
    {!editing && message ? <p role="status">{message}</p> : null}
    {editing ? <FolderModal copy={copy} title={editing === 'new' ? copy.folderNew : copy.folderRename} busy={busy} onCancel={() => setEditing(null)}>
      <label>{copy.folderName}<input value={name} disabled={busy} onChange={event => setName(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') void save(); }} /></label>
      <p role="status">{message}</p><div className="confirm-actions"><button disabled={busy} onClick={() => setEditing(null)}>{copy.cancel}</button><button disabled={busy} className="primary" onClick={() => void save()}>{copy.decisionSave}</button></div>
    </FolderModal> : null}
    {removing ? <ConfirmDialog copy={copy} title={copy.folderDelete} message={copy.folderDeleteConfirm} confirmLabel={copy.decisionConfirm} cancelLabel={copy.cancel} onCancel={() => setRemoving(null)} onConfirm={() => {
      const id = removing.id; setRemoving(null); requestDecisionNavigation(() => { setBusy(true);
      shell.deleteFolder(id).then(() => { runApprovedDecisionNavigation(() => onSelect('')); onChanged(); }).catch(() => setMessage(copy.folderFailed)).finally(() => setBusy(false)); });
    }} /> : null}
  </aside>;
}
