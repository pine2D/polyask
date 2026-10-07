import React, { act, useState } from 'react';
import type { ArchiveRecord } from '../../src/shared/archive';
import { createArchiveRecord } from '../../src/shared/archive';
import type { DecisionRecord } from '../../src/shared/decision';
import type { FolderContent, FolderFilters, TaskFolder } from '../../src/shared/task-folder';
import { getCopy } from '../../src/shared/copy';
import { ArchiveDetail } from '../../src/renderer/archive-detail';
import type { ArchiveSurfaceProps } from '../../src/renderer/archive-surface';
import { FolderWorkspace } from '../../src/renderer/folder-workspace';
import { LibraryContentList } from '../../src/renderer/library-content-list';
import type { ArchiveReaderState } from '../../src/renderer/archive-reader-session';
import { archiveFixture } from '../fixtures';
import { mountDom } from './dom-harness';

export async function mountLibrary(node: React.ReactNode) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'ResizeObserver');
  Object.defineProperty(globalThis, 'ResizeObserver', { configurable: true, value: class {
    observe() {} unobserve() {} disconnect() {}
  } });
  try {
    const h = await mountDom(node);
    return { ...h, close: async () => { await h.close();
      if (descriptor) Object.defineProperty(globalThis, 'ResizeObserver', descriptor); else Reflect.deleteProperty(globalThis, 'ResizeObserver');
    } };
  } catch (error) {
    if (descriptor) Object.defineProperty(globalThis, 'ResizeObserver', descriptor); else Reflect.deleteProperty(globalThis, 'ResizeObserver');
    throw error;
  }
}

export const copy = getCopy('en');
export const record = archiveFixture();
export const folder: TaskFolder = { id: 'work', name: 'Research', schema: 3, deviceId: 'test', createdAt: 100, updatedAt: 100 };
export const waitForQuery = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 215)); });
export const waitForInitial = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 25)); });
export const readerTitle = (doc: Document) => doc.querySelector('.archive-detail-heading h1')?.textContent ?? null;
export function button(doc: Document, selector: string): HTMLButtonElement {
  const node = doc.querySelector<HTMLButtonElement>(selector);
  if (!node) throw new Error(`Expected visible control: ${selector}`);
  return node;
}
export function archiveItems(count: number): FolderContent[] {
  return Array.from({ length: count }, (_, index) => ({ kind: 'archive', record: createArchiveRecord({
    ...record, task: `Result ${String(index).padStart(4, '0')}`, ts: 1_000 + index,
    createdAt: 1_000 + index, updatedAt: 10_000 - index,
  }, { id: `result-${String(index).padStart(4, '0')}`, now: 10_000 - index, deviceId: 'test' }) }));
}
export const decision: DecisionRecord = {
  id: record.id, archiveId: record.id, sourceTitle: record.task, title: 'Decision with the same ID',
  conclusion: '', rationale: '', uncertainties: '', nextStep: '', status: 'draft', evidence: [],
  schema: 2, deviceId: 'test', createdAt: 1_000, updatedAt: 1_000,
};
type SessionState = {
  filters: FolderFilters; sort: 'updated-desc' | 'created-desc' | 'title-asc'; page: number; listScroll: number;
  selectedKey: string | null; pane: 'navigation' | 'list' | 'detail'; focused: boolean;
  consumedNavigationKey: string | null; reader: ArchiveReaderState | null;
};
export function sessionFixture(initial: Partial<SessionState> = {}) {
  const defaults: SessionState = { filters: { folderId: '' }, sort: 'updated-desc', page: 0, listScroll: 0,
    selectedKey: null, pane: 'list', focused: false, consumedNavigationKey: null, reader: null };
  let state = { ...defaults, ...initial };
  return { read: () => state, update: (patch: Partial<SessionState>) => { state = { ...state, ...patch }; },
    clear: () => { state = { ...defaults }; } };
}
export function workspace(extra: Partial<ArchiveSurfaceProps> & {
  session?: ReturnType<typeof sessionFixture>; navigationRevision?: number;
  onBlockingChange?: (value: boolean) => void;
} = {}) {
  return <FolderWorkspace copy={copy} locale="en" preferredId={record.id} onClose={() => {}}
    onCapture={async () => record} sites={[]} synthesisSites={[]} defaultTier={null}
    pendingSynthesis={null} synthesisCandidate={null} onSendSynthesis={async () => {}}
    onCollectSynthesis={async () => {}} onSaveSynthesis={async () => record} {...extra}
    renderArchive={value => <ArchiveDetail copy={copy} locale="en" record={value} busy={false}
      onPatch={() => {}} onOpenSource={() => {}} pendingSynthesis={null} synthesisCandidate={null}
      onSynthesize={() => {}} onCollectSynthesis={() => {}} onSaveSynthesis={() => {}} />} />;
}
export function ContentListHost({ items, page: initialPage = 0, loading = false, failed = false }: {
  items: readonly FolderContent[]; page?: number; loading?: boolean; failed?: boolean;
}) {
  const [page, setPage] = useState(initialPage);
  const [sort, setSort] = useState<'updated-desc' | 'created-desc' | 'title-asc'>('updated-desc');
  const [keys, setKeys] = useState<readonly string[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  return <><LibraryContentList copy={copy} locale="en" items={items} filters={{}} tags={[]}
    loading={loading} failed={failed} selectedKey={open} onChange={() => {}} onRetry={() => {}}
    onSelect={item => setOpen(`${item.kind}:${item.record.id}`)}
    {...{ page, sort, selectedKeys: keys, onPageChange: setPage, onSortChange: setSort, onSelectedKeysChange: setKeys }} />
    <output id="test-selected">{keys.join('\n')}</output><output id="test-open">{open}</output></>;
}
