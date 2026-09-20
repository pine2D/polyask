import { useCallback, useEffect, useRef, useState } from 'react';
import type { ArchiveRecord } from '../shared/archive';
import type { DecisionRecord } from '../shared/decision';
import type { FolderContent, FolderFilters, FolderTarget, TaskFolder } from '../shared/task-folder';
import type { ArchiveSurfaceProps } from './archive-surface';
import { FolderSidebar } from './folder-sidebar';
import { FolderMembershipDialog } from './folder-membership-dialog';
import { DecisionWorkspace } from './decision-workspace';
import { LibraryContentList } from './library-content-list';
import { changeFolderFilters } from './library-filters';
import { ArchiveIcon, CloseIcon, FocusIcon, BackIcon } from './icons';
import { requestDecisionNavigation } from './decision-navigation';
import { shell } from './shell-api';

const contentKey = (item: FolderContent) => `${item.kind}:${item.record.id}`;
export function FolderWorkspace(props: ArchiveSurfaceProps & {
  renderArchive: (record: ArchiveRecord, onChanged: (deleted?: boolean) => void, onCreateDecision: (source: ArchiveRecord) => void, onBusy: (busy: boolean) => void, onSavedArchive: (record: ArchiveRecord) => void, onOrganize: () => void) => React.ReactNode;
}): React.JSX.Element {
  const { copy } = props;
  const [folders, setFolders] = useState<TaskFolder[]>([]);
  const [items, setItems] = useState<FolderContent[]>([]);
  const [filters, setFilters] = useState<FolderFilters>({ folderId: '' });
  const [selected, setSelected] = useState<FolderContent | null>(null);
  const [detailRevision, setDetailRevision] = useState(0);
  const [newSource, setNewSource] = useState<ArchiveRecord | null>(null);
  const [membership, setMembership] = useState<FolderTarget | null>(null);
  const [tags, setTags] = useState<readonly string[]>([]);
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [focused, setFocused] = useState(false);
  const [pane, setPane] = useState<'navigation' | 'list' | 'detail'>('list');
  const epoch = useRef(0);
  const intent = useRef(0);
  const busyRef = useRef(false);
  const detailBusy = useCallback((value: boolean) => { busyRef.current = value; setBusy(value); }, []);
  const consumedPreferred = useRef<string | null>(null);
  const refresh = () => setRevision(value => value + 1);
  const navigate = (action: () => void) => { if (!busyRef.current) requestDecisionNavigation(() => { intent.current++; action(); }); };
  useEffect(() => {
    const request = ++epoch.current;
    const timer = setTimeout(() => {
      setLoading(true);
      Promise.all([shell.listFolders(), shell.searchFolderContents(filters), shell.searchArchives({})]).then(([nextFolders, contents, archives]) => {
        if (request !== epoch.current) return;
        setFolders(nextFolders); setItems(contents); setTags(archives.tags); setLoading(false); setMessage('');
        setSelected(current => current ? contents.find(item => contentKey(item) === contentKey(current)) ?? null : null);
      }).catch(() => { if (request === epoch.current) { setLoading(false); setMessage(copy.folderLoadFailed); } });
    }, filters.query ? 180 : 0);
    return () => { clearTimeout(timer); epoch.current++; };
  }, [filters, revision, copy.folderLoadFailed]);
  useEffect(() => {
    if (!props.preferredId || consumedPreferred.current === props.preferredId) return;
    let active = true;
    const requestIntent = intent.current;
    shell.getArchive(props.preferredId).then(record => {
      if (active && record && requestIntent === intent.current) navigate(() => { consumedPreferred.current = record.id; setFilters({ folderId: '' }); setSelected({ kind: 'archive', record }); setNewSource(null); setPane('detail'); });
    }).catch(() => { if (active) setMessage(copy.folderLoadFailed); });
    return () => { active = false; };
  }, [props.preferredId]);
  const change = (patch: Partial<FolderFilters>) => navigate(() => { epoch.current++; setFilters(current => changeFolderFilters(current, patch)); setSelected(null); setNewSource(null); setPane('list'); });
  const openArchive = (record?: ArchiveRecord) => navigate(() => { setNewSource(null); if (record) setFilters({ folderId: '' }); setSelected(record ? { kind: 'archive', record } : null); setPane(record ? 'detail' : 'list'); });
  const changed = (deleted = false) => { if (deleted) setSelected(null); refresh(); };
  const savedArchive = (record: ArchiveRecord) => { setFilters({ folderId: '' }); setSelected({ kind: 'archive', record }); setNewSource(null); setPane('detail'); refresh(); };
  const capture = () => navigate(() => {
    busyRef.current = true; setBusy(true);
    props.onCapture().then(savedArchive)
      .catch(() => setMessage(copy.archiveCollectFailed)).finally(() => { busyRef.current = false; setBusy(false); });
  });
  const updateDecision = (record?: DecisionRecord) => {
    if (newSource && record) setFilters({ folderId: '' });
    setNewSource(null); setSelected(record ? { kind: 'decision', record } : null); refresh();
  };
  const organize = () => navigate(() => { if (selected) { setDetailRevision(value => value + 1); setMembership({ kind: selected.kind, id: selected.record.id }); } });
  const folderName = folders.find(folder => folder.id === filters.folderId)?.name
    ?? (filters.folderId === '__unfiled__' ? copy.folderUnfiled : copy.folderAll);
  return <section className="folder-workspace library" data-focused={focused} data-pane={pane} aria-label={copy.archiveTitle} aria-busy={busy}>
    <header className="folder-toolbar">
      <strong><ArchiveIcon />{copy.archiveTitle}</strong>
      <span className="library-scope" title={folderName}>{folderName}</span>
      <div className="library-toolbar-actions">
        <button className="folder-back-navigation" onClick={() => navigate(() => { setFocused(false); setPane('navigation'); })}>{copy.folderTitle}</button>
        <button className="folder-back-list" onClick={() => navigate(() => { setNewSource(null); setPane('list'); })}><BackIcon />{copy.folderBackList}</button>
        <button className="library-focus" aria-pressed={focused} disabled={!selected && !newSource} title={focused ? copy.libraryBrowse : copy.libraryFocus} aria-label={focused ? copy.libraryBrowse : copy.libraryFocus} onClick={() => setFocused(value => !value)}><FocusIcon /></button>
        <button disabled={busy} onClick={capture}><ArchiveIcon /><span>{copy.captureArchive}</span></button>
        <button className="library-close" aria-label={copy.closeArchive} title={copy.closeArchive} disabled={busy} onClick={() => navigate(props.onClose)}><CloseIcon /></button>
      </div>
    </header>
    <div className="folder-columns">
      <FolderSidebar copy={copy} folders={folders} selected={filters.folderId ?? ''} onSelect={folderId => change({ folderId })} onChanged={refresh} />
      <LibraryContentList copy={copy} locale={props.locale} items={items} filters={filters} tags={tags} loading={loading}
        failed={!!message} selectedKey={selected ? contentKey(selected) : null} onChange={change} onRetry={refresh}
        onSelect={item => navigate(() => { setSelected(item); setNewSource(null); setPane('detail'); })} />
      <div className="folder-detail">
        {newSource || selected?.kind === 'decision' ? <DecisionWorkspace key={newSource ? `new:${newSource.id}` : `${selected!.record.id}:${detailRevision}`} embedded onOrganize={organize} copy={copy} locale={props.locale} initialSource={newSource} initialRecord={selected?.kind === 'decision' && !newSource ? selected.record : undefined} onArchives={openArchive} onClose={props.onClose} onChanged={updateDecision} />
          : selected?.kind === 'archive' ? props.renderArchive(selected.record, changed, source => navigate(() => setNewSource(source)), detailBusy, savedArchive, organize) : <div className="library-welcome"><ArchiveIcon /><h1>{copy.libraryPick}</h1><p>{copy.libraryPickHint}</p></div>}
      </div>
    </div>
    {message ? <div className="archive-status" role="status">{message}<button onClick={refresh}>{copy.retryShellLoad}</button></div> : null}
    {membership ? <FolderMembershipDialog key={`${membership.kind}:${membership.id}`} copy={copy} target={membership} folders={folders} onCancel={() => setMembership(null)} onSaved={() => { setMembership(null); refresh(); }} /> : null}
  </section>;
}
