import { useCallback, useEffect, useRef, useState } from 'react';
import type { ArchiveRecord } from '../shared/archive';
import type { DecisionRecord } from '../shared/decision';
import type { FolderContent, FolderFilters, FolderTarget, TaskFolder } from '../shared/task-folder';
import type { ArchiveSurfaceProps } from './archive-surface';
import { FolderSidebar } from './folder-sidebar';
import { FolderMembershipDialog } from './folder-membership-dialog';
import { DecisionWorkspace } from './decision-workspace';
import { decisionStatuses, decisionStatusLabel } from './decision-editor';
import { requestDecisionNavigation } from './decision-navigation';
import { shell } from './shell-api';

const contentKey = (item: FolderContent) => `${item.kind}:${item.record.id}`;
export function FolderWorkspace(props: ArchiveSurfaceProps & {
  renderArchive: (record: ArchiveRecord, onChanged: (deleted?: boolean) => void, onCreateDecision: (source: ArchiveRecord) => void, onBusy: (busy: boolean) => void, onSavedArchive: (record: ArchiveRecord) => void) => React.ReactNode;
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
  const change = (patch: Partial<FolderFilters>) => navigate(() => { epoch.current++; setFilters(current => ({ ...current, ...patch })); setSelected(null); setNewSource(null); setPane('list'); });
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
  return <section className="folder-workspace" data-pane={pane} aria-label={copy.archiveTitle} aria-busy={busy}>
    <header className="folder-toolbar">
      <strong>{copy.archiveTitle}</strong>
      <button className="folder-back-navigation" onClick={() => navigate(() => setPane('navigation'))}>{copy.folderBackNavigation}</button>
      <button className="folder-back-list" onClick={() => navigate(() => { setNewSource(null); setPane('list'); })}>{copy.folderBackList}</button>
      <button disabled={busy} onClick={capture}>{copy.captureArchive}</button>
      <button disabled={busy} onClick={() => navigate(props.onClose)}>{copy.closeArchive}</button>
    </header>
    <div className="folder-columns">
      <FolderSidebar copy={copy} folders={folders} selected={filters.folderId ?? ''} onSelect={folderId => change({ folderId })} onChanged={refresh} />
      <section className="folder-content-list" aria-label={copy.folderAll}>
        <div className="folder-filters">
          <input type="search" aria-label={copy.folderSearch} placeholder={copy.folderSearch} value={filters.query ?? ''} onChange={event => change({ query: event.target.value })} />
          <select aria-label={copy.folderKind} value={filters.kind ?? ''} onChange={event => change({ kind: event.target.value as FolderFilters['kind'] })}><option value="">{copy.folderAll}</option><option value="archive">{copy.folderResults}</option><option value="decision">{copy.decisionTitle}</option></select>
          {filters.kind !== 'decision' ? <><select aria-label={copy.archiveTags} value={filters.tag ?? ''} onChange={event => change({ tag: event.target.value })}><option value="">{copy.allArchiveTags}</option>{tags.map(tag => <option key={tag}>{tag}</option>)}</select><label><input type="checkbox" checked={!!filters.favorite} onChange={event => change({ favorite: event.target.checked })} />{copy.favoriteArchives}</label></> : null}
          {filters.kind !== 'archive' ? <select aria-label={copy.decisionStatus} value={filters.status ?? ''} onChange={event => change({ status: event.target.value as FolderFilters['status'] })}><option value="">{copy.decisionAll}</option>{decisionStatuses.map(status => <option key={status} value={status}>{decisionStatusLabel(copy, status)}</option>)}</select> : null}
        </div>
        <div className="archive-list">
          {loading ? <p role="status">{copy.archiveLoading}</p> : items.length ? items.map(item => <button key={contentKey(item)} aria-current={selected && contentKey(selected) === contentKey(item) ? 'true' : undefined} onClick={() => navigate(() => { setSelected(item); setNewSource(null); setPane('detail'); })}>
            <small>{item.kind === 'archive' ? copy.folderResults : decisionStatusLabel(copy, item.record.status)}</small>
            <span>{item.kind === 'archive' ? item.record.task || item.record.preview : item.record.title}</span>
            {item.kind === 'archive' && item.record.tags.length ? <small>{item.record.tags.join(' · ')}</small> : null}
          </button>) : <p>{copy.folderEmpty}</p>}
        </div>
      </section>
      <div className="folder-detail">
        {selected && !newSource ? <div className="folder-detail-heading"><button onClick={() => navigate(() => { setDetailRevision(value => value + 1); setMembership({ kind: selected.kind, id: selected.record.id }); })}>{copy.folderMembership}</button></div> : null}
        {newSource || selected?.kind === 'decision' ? <DecisionWorkspace key={newSource ? `new:${newSource.id}` : `${selected!.record.id}:${detailRevision}`} embedded copy={copy} locale={props.locale} initialSource={newSource} initialRecord={selected?.kind === 'decision' && !newSource ? selected.record : undefined} onArchives={openArchive} onClose={props.onClose} onChanged={updateDecision} />
          : selected?.kind === 'archive' ? props.renderArchive(selected.record, changed, source => navigate(() => setNewSource(source)), detailBusy, savedArchive) : <p className="decision-placeholder">{copy.folderEmpty}</p>}
      </div>
    </div>
    <div className="archive-status" role="status">{message}{message ? <button onClick={refresh}>{copy.retryShellLoad}</button> : null}</div>
    {membership ? <FolderMembershipDialog key={`${membership.kind}:${membership.id}`} copy={copy} target={membership} folders={folders} onCancel={() => setMembership(null)} onSaved={() => { setMembership(null); refresh(); }} /> : null}
  </section>;
}
