import { withFolderPages } from './library-page-api';
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import MarkdownIt from 'markdown-it';
import { ArchiveSurface } from '../../src/renderer/archive-surface';
import { createLibrarySessionStore } from '../../src/renderer/library-session';
import { setShellApi } from '../../src/renderer/shell-api';
import { archiveMatches } from '../../src/shared/archive';
import type { FolderFilters } from '../../src/shared/task-folder';
import { getCopy } from '../../src/shared/copy';
import { libraryReadingPerformanceData } from './library-reading-performance-data';
import '../../src/renderer/styles.css';

document.documentElement.lang = 'zh-CN';
const data = libraryReadingPerformanceData(), copy = getCopy('zh-CN'), session = createLibrarySessionStore();
const longSources = new Set(data.longSources);
const state = { workload: data.workload, query: '', total: 0, readySequence: 0,
  parseCalls: 0, longParses: 0, parseMs: 0, start: 0, parentRevision: 0,
  mount: (_value: boolean) => {}, redraw: () => {}, completeRead: () => false };
state.completeRead = () => {
  const title = document.querySelector('.archive-detail-heading h1')?.textContent;
  const record = data.archives.slice(0, 2).find(item => item.task === title);
  const answers = document.querySelectorAll('.archive-answer');
  return !!record && answers.length === 9 && record.results.every((answer, index) =>
    answers[index].textContent?.includes(answer.text!.slice(answer.text!.lastIndexOf('## End of complete answer ') + 3)));
};
const parse = MarkdownIt.prototype.parse;
MarkdownIt.prototype.parse = function(this: InstanceType<typeof MarkdownIt>, value: string, env: Parameters<typeof parse>[1]) {
  state.parseCalls++; if (longSources.has(value)) state.longParses++;
  const before = performance.now();
  try { return parse.call(this, value, env); } finally { state.parseMs += performance.now() - before; }
};
setShellApi(withFolderPages({ listFolders: async () => [], listArchiveTags: async () => [],
  searchFolderContents: async (filters: FolderFilters) => {
    const query = (filters.query ?? '').trim().toLowerCase();
    const result = data.items.filter(item => (!filters.kind || filters.kind === item.kind)
      && (item.kind === 'archive' ? archiveMatches(item.record, filters)
        : (!filters.favorite && !filters.tag && (!filters.status || item.record.status === filters.status)
          && [item.record.title, item.record.conclusion, item.record.rationale, item.record.uncertainties,
            item.record.nextStep, item.record.sourceTitle].join('\n').toLowerCase().includes(query))));
    state.query = query; state.total = result.length; state.readySequence++; return result;
  }, getArchive: async (id: string) => data.archives.find(record => record.id === id) ?? null,
  openExternal: async () => { throw Error('post workload must not open external sources'); },
}) as any);
function Fixture() {
  const [opened, setOpened] = useState(true), [revision, setRevision] = useState(0);
  state.mount = value => { if (value) session.clear(); state.start = performance.now(); setOpened(value); };
  state.redraw = () => { state.start = performance.now(); setRevision(value => value + 1); };
  state.parentRevision = revision;
  return <main data-parent-revision={revision}>{opened ? <ArchiveSurface copy={copy} locale="zh-CN" session={session}
    preferredId={null} onClose={() => setOpened(false)} onCapture={async () => data.archives[0]} sites={[]}
    synthesisSites={[]} defaultTier={null} pendingSynthesis={null} synthesisCandidate={null}
    onSendSynthesis={async () => {}} onCollectSynthesis={async () => {}} onSaveSynthesis={async () => data.archives[0]} /> : null}</main>;
}
(window as any).u32Post = state;
state.start = performance.now();
createRoot(document.getElementById('root')!).render(<Fixture />);
