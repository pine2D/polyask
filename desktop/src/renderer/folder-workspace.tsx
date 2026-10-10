import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ArchiveRecord } from '../shared/archive';
import type { DecisionInput, DecisionRecord } from '../shared/decision';
import type { FolderContent, FolderFilters, FolderTarget, TaskFolder } from '../shared/task-folder';
import type { FolderContentSummary } from '../shared/task-folder-page';
import type { ArchiveSurfaceProps } from './archive-surface';
import { FolderSidebar } from './folder-sidebar';
import { FolderMembershipDialog } from './folder-membership-dialog';
import { DecisionWorkspace } from './decision-workspace';
import { LibraryContentList } from './library-content-list';
import { changeFolderFilters } from './library-filters';
import { ArchiveIcon, CloseIcon, FocusIcon, BackIcon } from './icons';
import { requestDecisionNavigation } from './decision-navigation';
import { shell } from './shell-api';
import { useLibraryReadingFocus, type LibraryReadingFocus } from './library-reading-focus';
import { createLibrarySessionStore, type LibrarySessionStore } from './library-session';
import { contentKey, type LibrarySort } from './library-list-model';
import { readFolderContent, targetFromContentKey } from './library-content-loader';
import { getLibraryCopy } from '../shared/library-scale-copy';
import { useLibraryBulk } from './use-library-bulk';
import { LibraryBulkActions } from './library-bulk-actions';
import { LibraryBulkFolderDialog } from './library-bulk-folder-dialog';
import type { BulkRequest } from './library-bulk-runner';

export function FolderWorkspace(props: ArchiveSurfaceProps & {
  session?: LibrarySessionStore; navigationRevision?: number; onBlockingChange?: (value: boolean) => void;
  renderArchive: (record: ArchiveRecord, onChanged: (deleted?: boolean) => void, onCreateDecision: (source: ArchiveRecord, draft?: DecisionInput) => void, onBusy: (busy: boolean) => void, onSavedArchive: (record: ArchiveRecord) => void, onOrganize: () => void, readingFocus: LibraryReadingFocus, readerNavigationKey: string | null) => React.ReactNode;
}): React.JSX.Element {
  const { copy } = props;
  const ownSession = useRef(createLibrarySessionStore());
  const session = props.session ?? ownSession.current;
  const initial = useRef(session.read()).current;
  const [folders, setFolders] = useState<TaskFolder[]>([]);
  const [items, setItems] = useState<readonly FolderContentSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [filters, setFilters] = useState<FolderFilters>(initial.filters);
  const [sort, setSort] = useState<LibrarySort>(initial.sort);
  const [page, setPage] = useState(initial.page);
  const [selectedKeys, setSelectedKeys] = useState<readonly string[]>([]);
  const [selected, setSelected] = useState<FolderContent | null>(null);
  const [detailRevision, setDetailRevision] = useState(0);
  const [newSource, setNewSource] = useState<ArchiveRecord | null>(null);
  const [newDraft, setNewDraft] = useState<DecisionInput | undefined>(undefined);
  const [membership, setMembership] = useState<(FolderTarget & { title: string }) | null>(null);
  const [tags, setTags] = useState<readonly string[]>([]);
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [bulkFolders, setBulkFolders] = useState(false);
  const [focused, setFocused] = useState(initial.focused);
  const [pane, setPane] = useState<'navigation' | 'list' | 'detail'>(initial.pane);
  const epoch = useRef(0);
  const intent = useRef(0);
  const busyRef = useRef(false);
  const blockers = useRef(new Set<string>()), mounted = useRef(true);
  const notify = useRef(props.onBlockingChange); notify.current = props.onBlockingChange;
  const blocking = useCallback((source: string, value: boolean) => {
    if (!mounted.current) return;
    if (value) blockers.current.add(source); else blockers.current.delete(source);
    const next = blockers.current.size > 0;
    if (next !== busyRef.current) { busyRef.current = next; setBusy(next); notify.current?.(next); }
  }, []);
  const detailBusy = useCallback((value: boolean) => blocking('detail', value), [blocking]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false;
    if (busyRef.current) notify.current?.(false); blockers.current.clear(); busyRef.current = false;
  }; }, []);
  const consumedPreferred = useRef(initial.consumedNavigationKey);
  const restoringKey = useRef(initial.selectedKey);
  const selectedRef = useRef(selected); selectedRef.current = selected;
  const selectedKeysRef = useRef(selectedKeys); selectedKeysRef.current = selectedKeys;
  const filterChanged = useRef(false);
  const listScroll = useRef(initial.listScroll);
  const refresh = () => setRevision(value => value + 1);
  const bulk = useLibraryBulk(value => blocking('bulk', value), refresh);
  const navigate = (action: () => void) => {
    if (busyRef.current) return;
    const navigationIntent = ++intent.current;
    requestDecisionNavigation(() => {
      if (navigationIntent !== intent.current || busyRef.current) return;
      listScroll.current = reading.root.current?.querySelector<HTMLElement>('.archive-list')?.scrollTop ?? listScroll.current;
      action();
    });
  };
  const reading = useLibraryReadingFocus(focused, selected ? contentKey(selected) : null);
  const focusDetail = (value: boolean) => navigate(() => { reading.capture(value); setFocused(value); });
  useLayoutEffect(() => {
    session.update({ filters, sort, page, listScroll: listScroll.current, pane, focused,
      selectedKey: selected ? contentKey(selected) : restoringKey.current, consumedNavigationKey: consumedPreferred.current });
  }, [session, filters, sort, page, pane, focused, selected]);
  useEffect(() => {
    const request = ++epoch.current;
    const requestIntent = intent.current;
    const timer = setTimeout(() => {
      setLoading(true);
      const target = targetFromContentKey(selectedRef.current ? contentKey(selectedRef.current) : restoringKey.current);
      const selection = selectedKeysRef.current.flatMap(key => targetFromContentKey(key) ?? []);
      Promise.all([shell.listFolders(), shell.queryFolderContents({ ...filters, page, sort, locale: props.locale,
        selected: target ?? undefined, selectedTargets: selection, locateSelected: filterChanged.current }), shell.listArchiveTags()]).then(async ([nextFolders, contents, nextTags]) => {
        if (request !== epoch.current) return;
        const match = contents.selected && requestIntent === intent.current ? await readFolderContent(contents.selected) : null;
        if (request !== epoch.current) return;
        setFolders(nextFolders); setItems(contents.items); setTotal(contents.total); setPage(contents.page);
        const live = new Set(contents.selectedTargets.map(target => `${target.kind}:${target.id}`));
        setSelectedKeys(current => current.filter(key => live.has(key)));
        setTags(nextTags); setLoading(false); setLoadFailed(false); setMessage('');
        const key = target ? `${target.kind}:${target.id}` : null;
        restoringKey.current = null;
        if (key && requestIntent === intent.current) {
          if (match) setSelected(match);
          else {
            const responseSelection = selectedRef.current ? contentKey(selectedRef.current) : null;
            requestDecisionNavigation(() => {
              const currentSelection = selectedRef.current ? contentKey(selectedRef.current) : null;
              if (request !== epoch.current || requestIntent !== intent.current || responseSelection !== currentSelection) return;
              setSelected(null); setFocused(false); setPane('list'); session.update({ reader: null });
            });
          }
        }
        if (filterChanged.current) {
          listScroll.current = 0;
          filterChanged.current = false;
        }
      }).catch(() => { if (request === epoch.current) { setLoading(false); setLoadFailed(true); setMessage(copy.folderLoadFailed); } });
    }, filters.query ? 180 : 0);
    return () => { clearTimeout(timer); epoch.current++; };
  }, [filters, revision, page, sort, props.locale, copy.folderLoadFailed]);
  useEffect(() => {
    const navigationKey = props.preferredId ? JSON.stringify([props.preferredId, props.navigationRevision ?? 0]) : null;
    if (!props.preferredId || consumedPreferred.current === navigationKey) return;
    let active = true;
    const requestIntent = intent.current;
    shell.getArchive(props.preferredId).then(record => {
      if (active && record && requestIntent === intent.current) navigate(() => {
        consumedPreferred.current = navigationKey; restoringKey.current = null; filterChanged.current = true;
        session.update({ reader: null });
        setFilters({ folderId: '' }); setSelected({ kind: 'archive', record }); setNewSource(null); setPane('detail');
      });
    }).catch(() => { if (active) setMessage(copy.folderLoadFailed); });
    return () => { active = false; };
  }, [props.preferredId, props.navigationRevision]);
  const change = (patch: Partial<FolderFilters>) => navigate(() => {
    epoch.current++; filterChanged.current = true; setLoading(true); setLoadFailed(false);
    setFilters(current => changeFolderFilters(current, patch)); setNewSource(null);
    if (!selected) setPane('list');
  });
  const changeSort = (value: LibrarySort) => navigate(() => {
    filterChanged.current = true; setLoading(true); setSort(value); listScroll.current = 0;
  });
  const openArchive = (record?: ArchiveRecord) => navigate(() => { setNewSource(null); if (record) setFilters({ folderId: '' }); setSelected(record ? { kind: 'archive', record } : null); setPane(record ? 'detail' : 'list'); });
  const changed = (deleted = false) => { if (deleted) { setSelected(null); setFocused(false); setPane('list'); } refresh(); };
  const savedArchive = (record: ArchiveRecord) => { setFilters({ folderId: '' }); setSelected({ kind: 'archive', record }); setNewSource(null); setPane('detail'); refresh(); };
  const capture = () => navigate(() => {
    blocking('capture', true);
    props.onCapture().then(value => { if (mounted.current) savedArchive(value); })
      .catch(() => { if (mounted.current) setMessage(copy.archiveCollectFailed); }).finally(() => blocking('capture', false));
  });
  const updateDecision = (record?: DecisionRecord) => {
    if (newSource && record) setFilters({ folderId: '' });
    if (!record) { setFocused(false); setPane('list'); }
    setNewSource(null); setSelected(record ? { kind: 'decision', record } : null); refresh();
  };
  const organize = () => navigate(() => { if (selected) { setDetailRevision(value => value + 1); setMembership({ kind: selected.kind, id: selected.record.id, title: selected.kind === 'decision' ? selected.record.title : selected.record.task || selected.record.text }); } });
  const createdFolder = (folder: TaskFolder) => {
    epoch.current++;
    setFolders(items => [...items.filter(item => item.id !== folder.id), folder]);
    refresh();
  };
  const folderName = folders.find(folder => folder.id === filters.folderId)?.name
    ?? (filters.folderId === '__unfiled__' ? copy.folderUnfiled : copy.folderAll);
  const targets = selectedKeys.flatMap(key => targetFromContentKey(key) ?? []);
  const unavailable = busy || loading || loadFailed || !targets.length;
  const startBulk = (action: BulkRequest['action'], favorite?: boolean, folderIds?: readonly string[]) => navigate(() => {
    if (loading || loadFailed || !targets.length) return;
    setBulkFolders(false); bulk.start({ action, favorite, folderIds, targets, locale: props.locale });
  });
  const labels = getLibraryCopy(props.locale);
  return <section ref={reading.root} className="folder-workspace library" data-focused={focused} data-pane={pane} aria-label={copy.archiveTitle} aria-busy={busy}>
    <header className="folder-toolbar">
      <strong><ArchiveIcon />{copy.archiveTitle}</strong>
      <span className="library-scope" title={folderName}>{folderName}</span>
      <div className="library-toolbar-actions">
        <button className="folder-back-navigation" onClick={() => navigate(() => { setFocused(false); setPane('navigation'); })}>{copy.folderTitle}</button>
        <button className="folder-back-list" onClick={() => navigate(() => { setNewSource(null); setPane('list'); })}><BackIcon />{copy.folderBackList}</button>
        <button className="library-focus" aria-pressed={focused} disabled={busy || (!focused && !selected && !newSource)} title={focused ? copy.libraryBrowse : copy.libraryFocus} aria-label={focused ? copy.libraryBrowse : copy.libraryFocus} onClick={() => focusDetail(!focused)}><FocusIcon /></button>
        <button disabled={busy} onClick={capture}><ArchiveIcon /><span>{copy.captureArchive}</span></button>
        <button className="panel-close library-close" aria-label={copy.closeArchive} title={copy.closeArchive} disabled={busy} onClick={() => navigate(props.onClose)}><CloseIcon /></button>
      </div>
    </header>
    <LibraryBulkActions labels={labels} count={selectedKeys.length} mixed={targets.some(target => target.kind === 'decision')}
      disabled={unavailable} running={bulk.running} done={bulk.done} result={bulk.result} onFavorite={value => startBulk('favorite', value)}
      onAdd={() => navigate(() => setBulkFolders(true))} onExport={() => startBulk('export')} onStop={bulk.stop}
      onRetry={() => navigate(() => {
        if (loading || loadFailed || !bulk.result) return;
        const retryIntent = intent.current;
        shell.queryFolderContents({ ...filters, selectedTargets: bulk.result.outcome.failed }).then(result => {
          if (mounted.current && retryIntent === intent.current) bulk.retry(result.selectedTargets);
        }).catch(() => { if (mounted.current) setMessage(copy.folderLoadFailed); });
      })} />
    <div className="folder-columns">
      <FolderSidebar copy={copy} locale={props.locale} folders={folders} selected={filters.folderId ?? ''} disabled={busy} onSelect={folderId => change({ folderId })} onChanged={refresh} />
      <LibraryContentList copy={copy} locale={props.locale} items={items} filters={filters} tags={tags} loading={loading}
        serverPage={{ page, total }}
        failed={loadFailed} selectedKey={selected ? contentKey(selected) : null} onChange={change} onRetry={refresh}
        page={page} sort={sort} selectedKeys={selectedKeys} onSelectedKeysChange={setSelectedKeys}
        onPageChange={value => navigate(() => { setLoading(true); setPage(value); listScroll.current = 0; })} onSortChange={changeSort}
        listScroll={listScroll.current} onScroll={value => { listScroll.current = value; session.update({ listScroll: value }); }} disabled={busy}
        onSelect={item => navigate(() => {
          const readingIntent = intent.current;
          readFolderContent({ kind: item.kind, id: item.record.id }).then(record => {
            if (!mounted.current || readingIntent !== intent.current) return;
            requestDecisionNavigation(() => {
              if (!mounted.current || readingIntent !== intent.current || busyRef.current) return;
              setSelected(record); setNewSource(null); setPane(record ? 'detail' : 'list');
              setMessage(record ? '' : copy.folderLoadFailed);
            });
          }).catch(() => { if (mounted.current && readingIntent === intent.current) setMessage(copy.folderLoadFailed); });
        })} />
      <div className="folder-detail">
        {newSource || selected?.kind === 'decision' ? <DecisionWorkspace key={newSource ? `new:${newSource.id}` : `${selected!.record.id}:${detailRevision}`} embedded onBusy={detailBusy} onOrganize={organize} copy={copy} locale={props.locale} initialSource={newSource} initialDraft={newSource ? newDraft : undefined} initialRecord={selected?.kind === 'decision' && !newSource ? selected.record : undefined} onArchives={openArchive} onClose={props.onClose} onChanged={updateDecision} />
          : selected?.kind === 'archive' ? props.renderArchive(selected.record, changed, (source, draft) => navigate(() => { setNewSource(source); setNewDraft(draft); }), detailBusy, savedArchive, organize, { focused, onFocus: focusDetail }, consumedPreferred.current) : <div className="library-welcome"><ArchiveIcon /><h1>{copy.libraryPick}</h1><p>{copy.libraryPickHint}</p></div>}
      </div>
    </div>
    {message ? <div className="archive-status" role="status">{message}<button onClick={refresh}>{copy.retryShellLoad}</button></div> : null}
    {membership ? <FolderMembershipDialog key={`${membership.kind}:${membership.id}`} copy={copy} target={{ kind: membership.kind, id: membership.id }} targetTitle={membership.title} folders={folders} onCreated={createdFolder} onCancel={() => setMembership(null)} onSaved={() => { setMembership(null); refresh(); }} /> : null}
    {bulkFolders && <LibraryBulkFolderDialog copy={copy} labels={labels} folders={folders} count={targets.length}
      onCancel={() => setBulkFolders(false)} onConfirm={ids => startBulk('add-folder', undefined, ids)} />}
  </section>;
}
