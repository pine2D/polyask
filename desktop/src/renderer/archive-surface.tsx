import { useEffect, useRef, useState } from "react";

import type { ArchivePatch, ArchiveRecord } from "../shared/archive";
import type { SiteDefinition } from "../shared/contracts";
import type { DesktopCopy } from "../shared/copy";
import type { Tier } from "../shared/protocol";
import type { DraftReceipt } from './draft-receipt';
import { describeSynthesisSendCode, errorCode } from "../shared/status-copy";
import type { PendingSynthesis, SynthesisCandidate, SynthesisSendRequest } from "../shared/synthesis";
import { FolderWorkspace } from "./folder-workspace";
import { ArchiveWorkspace } from "./archive-workspace";
import { SerialActions, type ActionFailure } from "./serial-actions";
import { SynthesisWorkspace } from "./synthesis-workspace";
import { requestDecisionNavigation } from "./decision-navigation";
import { shell } from "./shell-api";
import type { SynthesisDraft, SynthesisDraftStore } from "./synthesis-draft";
import type { SynthesisEditorRequest } from "./use-synthesis-recovery";
import type { LibraryReadingFocus } from './library-reading-focus';
import type { DecisionInput } from '../shared/decision';
import { useExcerptActions } from './use-excerpt-actions';
import type { SynthesisSession } from './synthesis-session';
import { createComparisonDraftStore, type ComparisonDraftStore } from './comparison-draft-store';
import type { LibrarySessionStore } from './library-session';
import { useArchiveReader, type ArchiveDetailView } from './archive-reader-session';
export type { ArchiveDetailView } from './archive-reader-session';

export interface ArchiveSurfaceProps {
  readonly session?: LibrarySessionStore;
  readonly navigationRevision?: number;
  readonly onBlockingChange?: (blocked: boolean) => void;
  readonly onArchiveEntered?: (archiveId: string, mode: ArchiveDetailView) => void;
  readonly copy: DesktopCopy;
  readonly locale: string;
  readonly onClose: () => void;
  readonly onCapture: () => Promise<ArchiveRecord>;
  readonly sites: readonly SiteDefinition[];
  readonly synthesisSites: readonly SiteDefinition[];
  readonly defaultTier: Tier;
  readonly comparisonId?: string | null;
  readonly preferredId: string | null;
  readonly pendingSynthesis: PendingSynthesis | null;
  readonly synthesisCandidate: SynthesisCandidate | null;
  readonly synthesisSession?: SynthesisSession | null;
  readonly comparisonDrafts?: ComparisonDraftStore;
  readonly onSendSynthesis: (request: SynthesisSendRequest, draft?: DraftReceipt) => Promise<void>;
  readonly onCollectSynthesis: () => Promise<void>;
  readonly onSaveSynthesis: (replaceExisting: boolean) => Promise<ArchiveRecord>;
  readonly synthesisDrafts?: SynthesisDraftStore;
  readonly synthesisEditorRequest?: SynthesisEditorRequest | null;
  readonly onSynthesisEditorOpened?: () => void;
}

function downloadMarkdown(markdown: string, createdAt: number): void {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([markdown], { type: "text/markdown" }));
  const stamp = new Date(createdAt).toISOString().slice(0, 16).replace(/[T:]/g, "-");
  link.download = `polyask-${stamp}.md`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 5_000);
}

interface ArchiveRequestEpoch {
  begin: () => number;
  invalidate: () => void;
  applyLatest: (epoch: number, apply: () => void) => void;
}

export interface ArchiveFilters {
  readonly query: string;
  readonly favorite: boolean;
  readonly tag: string;
}

interface ArchiveSearchResult {
  readonly items: readonly ArchiveRecord[];
  readonly tags: readonly string[];
}

interface ArchiveRefreshEffects {
  readonly search: (filters: ArchiveFilters) => Promise<ArchiveSearchResult>;
  readonly setLoading: (value: boolean) => void;
  readonly apply: (result: ArchiveSearchResult, preferredId?: string) => void;
  readonly fail: () => void;
}

export function createArchiveRequestEpoch(): ArchiveRequestEpoch {
  let current = 0;
  return {
    begin: () => ++current,
    invalidate: () => { current += 1; },
    applyLatest: (epoch, apply) => {
      if (epoch === current) apply();
    }
  };
}

export function createArchiveRefresh(
  requestEpoch: ArchiveRequestEpoch,
  readFilters: () => ArchiveFilters,
  effects: ArchiveRefreshEffects
): (preferredId?: string) => Promise<void> {
  return async (preferredId?: string): Promise<void> => {
    const epoch = requestEpoch.begin();
    effects.setLoading(true);
    try {
      const result = await effects.search(readFilters());
      requestEpoch.applyLatest(epoch, () => effects.apply(result, preferredId));
    } catch {
      requestEpoch.applyLatest(epoch, effects.fail);
    }
  };
}

// preferredId 只在它第一次出现时应该抢占选中项（比如刚发出的综合任务落库）；
// 之后每次筛选变化重跑同一个 effect 都会把它带上,若不加消费标记会一直把选中项拉回该记录,
// 用户在筛出别的记录后仍会被拽回去。lastConsumed 记录"已经用掉的那个 preferredId"。
export function resolveFilterRefreshTarget(
  preferredId: string | null,
  lastConsumed: string | null
): { readonly target: string | undefined; readonly consumed: string | null } {
  if (preferredId !== null && preferredId !== lastConsumed) {
    return { target: preferredId, consumed: preferredId };
  }
  return { target: undefined, consumed: lastConsumed };
}

export function startArchiveFilterIntent<T>(
  requestEpoch: ArchiveRequestEpoch,
  setFilter: (value: T) => void,
  value: T,
  setLoading: (value: boolean) => void,
  setStatus: (value: string) => void
): void {
  // 只作废在途请求、清空旧状态文案；不在按键当下置 loading——那会让整个防抖窗口里
  // 结果区反复闪成占位态。真正的 loading 由 createArchiveRefresh 在实际发起搜索时置位。
  void setLoading;
  requestEpoch.invalidate();
  setStatus("");
  setFilter(value);
}

export function ArchiveSurface(props: ArchiveSurfaceProps): React.JSX.Element {
  const drafts = useRef<ComparisonDraftStore | null>(null);
  if (!drafts.current) drafts.current = createComparisonDraftStore();
  return <FolderWorkspace {...props} renderArchive={(record, onChanged, onCreateDecision, onBusy, onSavedArchive, onOrganize, readingFocus, readerNavigationKey) => <ArchiveRecordSurface key={`${record.id}:${readerNavigationKey ?? ""}`} {...props} comparisonDrafts={props.comparisonDrafts ?? drafts.current!} readingFocus={readingFocus} onOrganize={onOrganize} onBusy={onBusy} onSavedArchive={onSavedArchive} preferredId={record.id} embeddedRecord={record} onChanged={onChanged} onCreateDecision={onCreateDecision} />} />;
}

function ArchiveRecordSurface(props: ArchiveSurfaceProps & { embeddedRecord: ArchiveRecord; readingFocus: LibraryReadingFocus; onOrganize: () => void; onChanged: (deleted?: boolean) => void; onCreateDecision: (source: ArchiveRecord, draft?: DecisionInput) => void; onBusy: (busy: boolean) => void; onSavedArchive: (record: ArchiveRecord) => void }): React.JSX.Element {
  const [selected, setSelected] = useState(props.embeddedRecord);
  const reader = useArchiveReader(selected, selected.id === props.comparisonId,
    props.session?.read().reader, value => props.session?.update({ reader: value }));
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [followUpHost, setFollowUpHost] = useState<string | undefined>(undefined);
  const [synthesisId, setSynthesisId] = useState<string | null>(null);
  const entered = useRef<string | null>(null);
  useEffect(() => {
    if (synthesisId || reader.state.archiveId !== selected.id || selected.id !== props.embeddedRecord.id) { entered.current = null; return; }
    const key = `${selected.id}:${reader.state.view}`;
    if (entered.current === key || !props.onArchiveEntered) return;
    entered.current = key; props.onArchiveEntered(selected.id, reader.state.view);
  }, [selected.id, props.embeddedRecord.id, reader.state.view, synthesisId, props.onArchiveEntered]);
  const [synthesisSeed, setSynthesisSeed] = useState<(SynthesisDraft & { sourceChanged: boolean }) | null>(null);
  const excerpts = useExcerptActions({ copy: props.copy, busy, defaultTier: props.defaultTier, drafts: props.synthesisDrafts,
    onStatus: setStatus, onDecision: props.onCreateDecision,
    onFollowUp: (record, value, draft) => { setSelected(record); setSynthesisSeed(draft); setFollowUpHost(value.host); setSynthesisId(record.id); } });
  useEffect(() => {
    const request = props.synthesisEditorRequest;
    if (request?.archiveId !== props.embeddedRecord.id) return;
    setSynthesisSeed(null); setFollowUpHost(request.followUpHost); setSynthesisId(request.archiveId);
    props.onSynthesisEditorOpened?.();
  }, [props.synthesisEditorRequest, props.embeddedRecord.id]);
  const actionQueue = useRef<SerialActions | null>(null);
  const sourceReadEpoch = useRef(0), sourceMounted = useRef(false);
  useEffect(() => { sourceMounted.current = true; return () => { sourceMounted.current = false; sourceReadEpoch.current++; }; }, []);
  if (!actionQueue.current) actionQueue.current = new SerialActions(setBusy, setStatus);
  useEffect(() => setSelected(props.embeddedRecord), [props.embeddedRecord]);
  useEffect(() => { props.onBusy(busy); return () => props.onBusy(false); }, [busy, props.onBusy]);
  const run = (action: () => Promise<void>, failure: ActionFailure): Promise<void> => actionQueue.current!.run(action, failure);
  const markdown = () => shell.archiveMarkdown(selected.id, props.locale);
  const savePatch = async (value: ArchivePatch): Promise<boolean> => {
    let saved = false;
    await run(async () => {
      const record = await shell.updateArchive(selected.id, value);
      setSelected(record); props.onChanged(); setStatus(props.copy.librarySaved); saved = true;
    }, props.copy.archiveSaveFailed);
    return saved;
  };
  const patch = (value: ArchivePatch) => { void savePatch(value); };
  const reloadSource = async () => {
    const request = ++sourceReadEpoch.current, id = selected.id;
    const record = await shell.getArchive(id);
    if (!sourceMounted.current || request !== sourceReadEpoch.current) return null;
    if (record?.id === id) setSelected(record);
    return record;
  };



  return (
    <><ArchiveWorkspace
      embedded
      onOrganize={props.onOrganize}
      readingFocus={props.readingFocus}
      comparisonDrafts={props.comparisonDrafts}
      reader={reader}
      onCreateDecisionDraft={props.onCreateDecision}
      copy={props.copy}
      onCreateDecision={value => value ? excerpts.evidence(value) : props.onCreateDecision(selected)}
      locale={props.locale}
      items={[selected]}
      selected={selected}
      comparisonId={props.comparisonId}
      tags={selected.tags}
      query=""
      favoriteOnly={false}
      selectedTag=""
      loading={false}
      busy={busy}
      status={status}
      onClose={props.onClose}
      onQueryChange={() => undefined}
      onFavoriteFilterChange={() => undefined}
      onTagChange={() => undefined}
      onSelect={() => undefined}
      onCapture={() => { void run(async () => {
        const record = await props.onCapture();
        props.onSavedArchive(record);
        setStatus(props.copy.archiveSaved);
      }, props.copy.archiveCollectFailed); }}
      onCopy={() => { void run(async () => {
        await navigator.clipboard.writeText(await markdown());
        setStatus(props.copy.archiveCopied);
      }, props.copy.archiveSaveFailed); }}
      onExport={() => { void run(async () => {
        if (!selected) return;
        downloadMarkdown(await markdown(), selected.ts);
        setStatus(props.copy.archiveExported);
      }, props.copy.archiveSaveFailed); }}
      onDelete={(id) => { void run(async () => {
        await shell.deleteArchive(id);
        props.onChanged(true);
      }, props.copy.archiveSaveFailed); }}
      onPatch={patch}
      onSaveMetadata={savePatch}
      onOpenSource={(url) => { void run(() => shell.openExternal(url), props.copy.archiveLoadFailed); }}
      pendingSynthesis={props.pendingSynthesis}
      synthesisCandidate={props.synthesisCandidate}
      synthesisSession={props.synthesisSession}
      detailOverride={synthesisId && selected?.id === synthesisId ? <SynthesisWorkspace key={`${selected.id}:${followUpHost ?? "synthesis"}`} followUpHost={followUpHost} copy={props.copy} record={selected} sites={props.synthesisSites} defaultTier={props.defaultTier} busy={busy} initialDraft={synthesisSeed ?? props.synthesisDrafts?.restore(selected, followUpHost)} onDraftChange={draft => props.synthesisDrafts?.save(selected, draft, followUpHost)} onReloadSource={reloadSource} onSourceReviewed={() => props.synthesisDrafts?.review(selected, followUpHost)} onCancel={() => { if (busy) shell.cancel(); else setSynthesisId(null); }} onSend={(request, receipt) => { return run(() => props.onSendSynthesis(request, receipt), (error) => describeSynthesisSendCode(props.copy, errorCode(error))); }} /> : undefined}
      onSynthesize={() => requestDecisionNavigation(() => { setSynthesisSeed(null); setFollowUpHost(undefined); setSynthesisId(selected.id); })}
      onFollowUp={(host, value) => value ? excerpts.followUp(value) : requestDecisionNavigation(() => { setSynthesisSeed(null); setFollowUpHost(host); setSynthesisId(selected.id); })}
      onCollectSynthesis={() => { void run(props.onCollectSynthesis, props.copy.synthesisCollectFailed); }}
      onSaveSynthesis={(replaceExisting) => { void run(async () => {
        const record = await props.onSaveSynthesis(replaceExisting);
        props.onSavedArchive(record);
        setStatus(props.copy.synthesisSavedDone);
      }, props.copy.archiveSaveFailed); }}
    />{excerpts.dialog}</>
  );
}
