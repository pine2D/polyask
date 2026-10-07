import { StrictMode, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ArchiveSurface } from '../../src/renderer/archive-surface';
import { createLibrarySessionStore } from '../../src/renderer/library-session';
import { setShellApi } from '../../src/renderer/shell-api';
import { getCopy } from '../../src/shared/copy';
import { getLibraryCopy } from '../../src/shared/library-scale-copy';
import type { ArchivePatch, ArchiveRecord } from '../../src/shared/archive';
import { isArchiveRecord } from '../../src/shared/archive';
import { isStoredDecision } from '../../src/shared/decision';
import type { FolderFilters } from '../../src/shared/task-folder';
import { libraryScaleData } from './library-scale-data';
import '../../src/renderer/styles.css';
import '../../src/renderer/library-scale.css';

const locale = new URLSearchParams(location.search).get('locale') ?? 'en';
document.documentElement.lang = locale;
const copy = getCopy(locale), labels = getLibraryCopy(locale), session = createLibrarySessionStore();
let items = libraryScaleData();
if (!items.every(item => item.kind === 'archive' ? isArchiveRecord(item.record) : isStoredDecision(item.record))) throw Error('native library fixture requires valid stored records');
const folder = { id: 'work', name: 'Research', schema: 3 as const, deviceId: 'fixture', createdAt: 100, updatedAt: 100 };
const membership = new Set(items.slice(0, 150).map(item => `${item.kind}:${item.record.id}`));
membership.add('decision:result-0000');
const state = { blocked: false, writes: [] as string[], blockingAtWrite: [] as boolean[], rejectedCommands: 0,
  queries: [] as FolderFilters[], finish: null as (() => void) | null, command: (_name: string) => false,
  labels: { ...labels, back: copy.folderBackList, folders: copy.folderTitle } };
const source = (): ArchiveRecord => items.find(item => item.kind === 'archive')!.record as ArchiveRecord;
setShellApi({ listFolders: async () => [{ ...folder, contentCount: membership.size }], listArchiveTags: async () => [],
  searchFolderContents: async (filters: FolderFilters) => {
    state.queries.push(filters);
    return items.filter(item => (!filters.kind || item.kind === filters.kind)
      && (!filters.folderId || filters.folderId === '__unfiled__' ? !filters.folderId || !membership.has(`${item.kind}:${item.record.id}`) : membership.has(`${item.kind}:${item.record.id}`))
      && (!filters.query || (item.kind === 'archive' ? item.record.task : item.record.title).toLowerCase().includes(filters.query.toLowerCase()))
      && (!filters.favorite || item.kind === 'archive' && item.record.favorite));
  }, getArchive: async (id: string) => items.find(item => item.kind === 'archive' && item.record.id === id)?.record ?? null,
  updateArchive: (id: string, patch: ArchivePatch) => {
    state.writes.push(id); state.blockingAtWrite.push(state.blocked);
    return new Promise<ArchiveRecord>(resolve => { state.finish = () => {
      items = items.map(item => item.kind === 'archive' && item.record.id === id ? { kind: 'archive', record: { ...item.record, ...patch } } : item);
      state.finish = null; resolve(items.find(item => item.kind === 'archive' && item.record.id === id)!.record as ArchiveRecord);
    }; });
  }, archiveMarkdown: async (id: string) => `# Canonical ${id}\n\tExact source\n`, decisionMarkdown: async () => '# Canonical decision\n',
  openExternal: async () => { throw Error('native library fixture must not open an external source'); },
} as any);

function Fixture() {
  const [opened, setOpened] = useState(true), [blocked, setBlocked] = useState(false);
  const blockedRef = useRef(false);
  state.command = () => {
    if (blockedRef.current) { state.rejectedCommands++; return false; }
    setOpened(false); return true;
  };
  return <main style={{ height: '100%', display: 'grid', gridTemplateRows: '40px minmax(0,1fr)' }}>
    <nav style={{ display: 'flex', gap: 8, padding: 4 }}><button id="library-away" style={{ minHeight: 32, minWidth: 80 }} disabled={blocked} onClick={() => state.command('away')}>Away</button>
      <button id="library-return" style={{ minHeight: 32, minWidth: 80 }} disabled={blocked || opened} onClick={() => setOpened(true)}>Return</button></nav>
    {opened ? <ArchiveSurface copy={copy} locale={locale} session={session} navigationRevision={1} preferredId="result-0000"
      onBlockingChange={value => { blockedRef.current = value; state.blocked = value; setBlocked(value); }}
      onClose={() => state.command('close')} onCapture={async () => source()} sites={[]} synthesisSites={[]} defaultTier={null}
      pendingSynthesis={null} synthesisCandidate={null} onSendSynthesis={async () => {}} onCollectSynthesis={async () => {}}
      onSaveSynthesis={async () => source()} /> : <p id="library-other-surface">Another surface</p>}
  </main>;
}
(window as any).libraryScale = state;
createRoot(document.getElementById('root')!).render(<StrictMode><Fixture /></StrictMode>);
