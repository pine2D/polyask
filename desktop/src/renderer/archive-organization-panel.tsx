import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { ArchivePatch, ArchiveRecord } from '../shared/archive';
import type { DesktopCopy } from '../shared/copy';
import { ArchiveMetadata } from './archive-metadata';
import { BackIcon } from './icons';
import { shell } from './shell-api';

interface ArchiveOrganizationPanelProps {
  record: ArchiveRecord; copy: DesktopCopy; busy: boolean; open: boolean;
  onOpenChange(open: boolean): void; onSave(patch: ArchivePatch): Promise<boolean>;
  onDirtyChange(dirty: boolean): void; onOpenMembership?: (afterSaved: () => void) => void;
}

export function ArchiveOrganizationPanel(props: ArchiveOrganizationPanelProps): React.JSX.Element {
  const { record, copy, open } = props;
  const [revision, setRevision] = useState(0);
  const [folders, setFolders] = useState<{ id: string; names: string[] | null; failed: boolean }>({ id: record.id, names: null, failed: false });
  const [saved, setSaved] = useState(false);
  const sequence = useRef(0), currentId = useRef(record.id), mounted = useRef(false);
  currentId.current = record.id;
  const close = useRef<HTMLButtonElement>(null), opener = useRef<HTMLElement | null>(null);
  const panel = useRef<HTMLElement>(null);
  const title = useId();
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; sequence.current++; }; }, []);
  useEffect(() => { setSaved(false); }, [record.id]);
  useLayoutEffect(() => {
    if (open) {
      opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      close.current?.focus({ preventScroll: true });
    } else {
      const previous = opener.current; opener.current = null;
      if (!previous) return;
      const target = panel.current?.closest('.folder-workspace')?.querySelector<HTMLElement>('.library-organize') ?? previous;
      if (target?.isConnected && !target.closest('[hidden],[inert]')) target.focus({ preventScroll: true });
    }
  }, [open]);
  useEffect(() => {
    const request = ++sequence.current;
    if (!open) return;
    setFolders({ id: record.id, names: null, failed: false });
    Promise.resolve().then(() => Promise.all([shell.listFolders(), shell.folderMemberships({ kind: 'archive', id: record.id })]))
      .then(([all, ids]) => {
        if (mounted.current && request === sequence.current && currentId.current === record.id)
          setFolders({ id: record.id, names: all.filter(folder => ids.includes(folder.id)).map(folder => folder.name), failed: false });
      }).catch(() => {
        if (mounted.current && request === sequence.current && currentId.current === record.id)
          setFolders({ id: record.id, names: null, failed: true });
      });
    return () => { sequence.current++; };
  }, [record.id, open, revision]);
  const current = folders.id === record.id ? folders : { names: null, failed: false };
  return <aside ref={panel} className="archive-organization-panel" hidden={!open} inert={!open} aria-labelledby={title}
    onKeyDown={event => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
      event.preventDefault(); props.onOpenChange(false);
    }}>
    <header><h2 id={title}>{copy.libraryOrganize}</h2>
      <button ref={close} type="button" className="archive-organization-close" onClick={() => props.onOpenChange(false)}><BackIcon />{copy.libraryCloseOrganization}</button>
    </header>
    <section className="archive-organization-folders" aria-label={copy.libraryOrganizationFolders}>
      <h3>{copy.libraryOrganizationFolders}</h3>
      {current.failed ? <p role="status">{copy.folderLoadFailed}</p> : current.names === null ? <p role="status">{copy.archiveLoading}</p>
        : current.names.length ? <ul>{current.names.map((name, index) => <li key={index}>{name}</li>)}</ul> : <p>{copy.folderUnfiled}</p>}
      {current.failed ? <button type="button" className="archive-organization-retry" onClick={() => setRevision(value => value + 1)}>{copy.retryShellLoad}</button> : null}
      {props.onOpenMembership ? <button type="button" className="archive-organization-membership" disabled={props.busy} onClick={() => {
        const id = record.id;
        props.onOpenMembership?.(() => {
          if (mounted.current && currentId.current === id) { setRevision(value => value + 1); setSaved(true); }
        });
      }}>{copy.libraryChangeMembership}</button> : null}
      {saved ? <p role="status">{copy.folderSaved}</p> : null}
    </section>
    <ArchiveMetadata record={record} copy={copy} busy={props.busy} presentation="panel" onSave={props.onSave}
      onDirtyChange={props.onDirtyChange} onRestoreEditing={() => props.onOpenChange(true)} />
  </aside>;
}
