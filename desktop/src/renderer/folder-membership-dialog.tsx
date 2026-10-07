import { useEffect, useId, useRef, useState } from 'react';
import { formatCopy } from "../shared/copy";
import type { DesktopCopy } from '../shared/copy';
import { validFolderName, type FolderMembershipChange, type FolderTarget, type TaskFolder } from '../shared/task-folder';
import { FolderModal } from './folder-modal';
import { shell } from './shell-api';

export function membershipChanges(before: readonly string[], after: readonly string[]): FolderMembershipChange[] {
  const old = new Set(before), next = new Set(after);
  return [...new Set([...before, ...after])].filter(id => old.has(id) !== next.has(id)).map(folderId => ({ folderId, present: next.has(folderId) }));
}
export function FolderMembershipDialog({ copy, target, targetTitle, folders, onCancel, onSaved, onCreated }: {
  copy: DesktopCopy; target: FolderTarget; targetTitle: string; folders: readonly TaskFolder[]; onCancel: () => void; onSaved: () => void;
  onCreated?: (folder: TaskFolder) => void;
}): React.JSX.Element {
  const [original, setOriginal] = useState<string[] | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [query, setQuery] = useState('');
  const [created, setCreated] = useState<TaskFolder[]>([]);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [nameAttempt, setNameAttempt] = useState(0);
  const pending = useRef(false);
  const nameInput = useRef<HTMLInputElement>(null);
  const newFolderFocus = useRef<string | null>(null);
  const choices = useRef<HTMLDivElement>(null);
  const nameId = useId();
  const nameInvalid = nameAttempt > 0 && !validFolderName(name);
  const allFolders = [...folders, ...created.filter(folder => !folders.some(existing => existing.id === folder.id))];
  const visibleFolders = allFolders.filter(folder => folder.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    shell.folderMemberships(target).then(ids => { if (active) { setOriginal(ids); setSelected(ids); setMessage(''); } })
      .catch(() => { if (active) setMessage(copy.folderLoadFailed); });
    return () => { active = false; };
  }, [target.id, target.kind, retry, copy.folderLoadFailed]);
  useEffect(() => { if (creating) nameInput.current?.focus(); }, [creating, nameAttempt]);
  useEffect(() => {
    if (!newFolderFocus.current) return;
    const checkbox = [...(choices.current?.querySelectorAll<HTMLInputElement>('input[type="checkbox"]') ?? [])]
      .find(input => input.dataset.folderId === newFolderFocus.current);
    checkbox?.focus(); newFolderFocus.current = null;
  }, [created]);
  const save = async () => {
    if (!original || pending.current) return;
    pending.current = true;
    setBusy(true); setMessage('');
    try { const changes = membershipChanges(original, selected); if (changes.length) await shell.patchFolderMemberships(target, changes); onSaved(); }
    catch { setMessage(copy.folderFailed); } finally { pending.current = false; setBusy(false); }
  };
  const create = async () => {
    if (!original || pending.current) return;
    if (!validFolderName(name)) { setNameAttempt(value => value + 1); return; }
    pending.current = true; setBusy(true); setMessage('');
    try {
      const folder = await shell.createFolder(name.trim());
      newFolderFocus.current = folder.id;
      setCreated(items => [...items, folder]); setSelected(ids => [...new Set([...ids, folder.id])]);
      onCreated?.(folder);
      setQuery(''); setCreating(false); setName(''); setNameAttempt(0);
    } catch { setMessage(copy.folderFailed); }
    finally { pending.current = false; setBusy(false); }
  };
  return <FolderModal copy={copy} title={copy.folderMembership} busy={busy} onCancel={onCancel}>
    <p className="folder-target-context">{formatCopy(target.kind === 'archive' ? copy.folderTargetResult : copy.folderTargetDecision, { title: targetTitle })}</p>
    <p>{copy.folderMembershipHint}</p>
    <input type="search" name="folder-membership-search" autoComplete="off" aria-label={copy.librarySearchFolders} placeholder={`${copy.librarySearchFolders}…`} value={query} disabled={busy} onChange={event => setQuery(event.target.value)} />
    <p className="library-selection-count">{formatCopy(copy.librarySelected, { count: selected.length })}</p>
    {!original ? <button disabled={busy} onClick={() => setRetry(value => value + 1)}>{message ? copy.retryShellLoad : copy.archiveLoading}</button> : allFolders.length ? <div className="folder-checkboxes" ref={choices}>{visibleFolders.map(folder => <label key={folder.id}><input type="checkbox" data-folder-id={folder.id} disabled={busy} checked={selected.includes(folder.id)} onChange={event => setSelected(ids => event.target.checked ? [...ids, folder.id] : ids.filter(id => id !== folder.id))} />{folder.name}</label>)}{!visibleFolders.length ? <p>{copy.archiveNoMatches}</p> : null}</div> : <p>{copy.folderNoFolders}</p>}
    {creating ? <form className="folder-create-form" onSubmit={event => { event.preventDefault(); void create(); }}>
      <label htmlFor={nameId}>{copy.folderName}</label><input id={nameId} ref={nameInput} name="folder-membership-name" autoComplete="off" value={name} disabled={busy}
        aria-invalid={nameInvalid || undefined} aria-describedby={`${nameId}-count${nameInvalid ? ` ${nameId}-error` : ''}`} onChange={event => setName(event.target.value)} />
      <p id={`${nameId}-count`} className="archive-field-hint">{[...name.trim()].length} / 80</p>
      {nameInvalid ? <p id={`${nameId}-error`} className="archive-field-errors">{copy.folderNameInvalid}</p> : null}
      <div className="confirm-actions"><button type="button" disabled={busy} onClick={() => setCreating(false)}>{copy.cancel}</button>
        <button type="submit" data-action="create-folder" disabled={busy}>{busy ? copy.librarySaving : copy.folderCreateAndSelect}</button></div>
    </form> : <button type="button" disabled={!original || busy} onClick={() => { setCreating(true); setMessage(''); }}>{copy.folderNew}</button>}
    <p role="status">{message}</p><div className="confirm-actions"><button disabled={busy} onClick={onCancel}>{copy.cancel}</button><button data-action="save-memberships" className="primary" disabled={!original || busy || creating} onClick={() => void save()}>{copy.decisionSave}</button></div>
  </FolderModal>;
}
