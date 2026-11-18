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
import { createLibrarySessionStore, type LibrarySessionStore } from './library-session';
import { useArchiveReader } from './archive-reader-session';
import { useMarkdownExport } from './use-markdown-export';
import { useReportExport } from './use-report-export';

export interface ArchiveSurfaceProps {
  readonly session?: LibrarySessionStore;
  readonly navigationRevision?: number;
  readonly onBlockingChange?: (blocked: boolean) => void;
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

export function ArchiveSurface(props: ArchiveSurfaceProps): React.JSX.Element {
  const drafts = useRef<ComparisonDraftStore | null>(null);
  const ownSession = useRef(createLibrarySessionStore());
  const session = props.session ?? ownSession.current;
  if (!drafts.current) drafts.current = createComparisonDraftStore();
  return <FolderWorkspace {...props} session={session} renderArchive={(record, onChanged, onCreateDecision, onBusy, onSavedArchive, onOrganize, readingFocus, readerNavigationKey) => <ArchiveRecordSurface key={`${record.id}:${readerNavigationKey ?? ""}`} {...props} session={session} comparisonDrafts={props.comparisonDrafts ?? drafts.current!} readingFocus={readingFocus} onOrganize={onOrganize} onBusy={onBusy} onSavedArchive={onSavedArchive} preferredId={record.id} embeddedRecord={record} onChanged={onChanged} onCreateDecision={onCreateDecision} />} />;
}

function ArchiveRecordSurface(props: ArchiveSurfaceProps & { embeddedRecord: ArchiveRecord; readingFocus: LibraryReadingFocus; onOrganize: (afterSaved?: () => void) => void; onChanged: (deleted?: boolean, starredRecord?: ArchiveRecord) => void; onCreateDecision: (source: ArchiveRecord, draft?: DecisionInput, origin?: string) => void; onBusy: (busy: boolean) => void; onSavedArchive: (record: ArchiveRecord) => void }): React.JSX.Element {
  const [selected, setSelected] = useState(props.embeddedRecord);
  const reader = useArchiveReader(selected, selected.id === props.comparisonId,
    props.session?.read().reader, value => props.session?.update({ reader: value }));
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const markdownExport = useMarkdownExport({ copy: props.copy, locale: props.locale, onStatus: setStatus });
  const blocked = busy || markdownExport.active || markdownExport.busy;
  const exportReport = useReportExport({ kind: 'archive', id: selected.id, copy: props.copy, locale: props.locale, onStatus: setStatus });
  const [followUpHost, setFollowUpHost] = useState<string | undefined>(undefined);
  const [synthesisId, setSynthesisId] = useState<string | null>(null);
  const [editorFocusOrigin, setEditorFocusOrigin] = useState<string | null>(null);
  const [synthesisSeed, setSynthesisSeed] = useState<(SynthesisDraft & { sourceChanged: boolean }) | null>(null);
  const excerpts = useExcerptActions({ copy: props.copy, busy, defaultTier: props.defaultTier, drafts: props.synthesisDrafts,
    onStatus: setStatus, onDecision: props.onCreateDecision,
    onFollowUp: (record, value, draft) => { setEditorFocusOrigin(`follow-up:${value.host}`); setSelected(record); setSynthesisSeed(draft); setFollowUpHost(value.host); setSynthesisId(record.id); } });
  useEffect(() => {
    const request = props.synthesisEditorRequest;
    if (request?.archiveId !== props.embeddedRecord.id) return;
    setEditorFocusOrigin(null); setSynthesisSeed(null); setFollowUpHost(request.followUpHost); setSynthesisId(request.archiveId);
    props.onSynthesisEditorOpened?.();
  }, [props.synthesisEditorRequest, props.embeddedRecord.id]);
  const actionQueue = useRef<SerialActions | null>(null);
  const sourceReadEpoch = useRef(0), sourceMounted = useRef(false);
  useEffect(() => { sourceMounted.current = true; return () => { sourceMounted.current = false; sourceReadEpoch.current++; }; }, []);
  if (!actionQueue.current) actionQueue.current = new SerialActions(setBusy, setStatus);
  useEffect(() => setSelected(props.embeddedRecord), [props.embeddedRecord]);
  useEffect(() => { props.onBusy(blocked); return () => props.onBusy(false); }, [blocked, props.onBusy]);
  const run = (action: () => Promise<void>, failure: ActionFailure): Promise<void> => actionQueue.current!.run(action, failure);
  const markdown = () => shell.archiveMarkdown(selected.id, props.locale);
  const savePatch = async (value: ArchivePatch): Promise<boolean> => {
    let saved = false;
    await run(async () => {
      const record = await shell.updateArchive(selected.id, value);
      setSelected(record); props.onChanged(false, 'favorite' in value ? record : undefined); setStatus(props.copy.librarySaved); saved = true;
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
      onCreateDecision={value => value ? excerpts.evidence(value) : props.onCreateDecision(selected, undefined, 'record')}
      locale={props.locale}
      items={[selected]}
      selected={selected}
      comparisonId={props.comparisonId}
      tags={selected.tags}
      query=""
      favoriteOnly={false}
      selectedTag=""
      loading={false}
      busy={blocked}
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
      }, props.copy.archiveCopyFailed); }}
      onExport={() => markdownExport.open([{ kind: 'archive', id: selected.id }])}
      onExportAnswer={index => { void markdownExport.single({ kind: 'archive', id: selected.id }, `result:${index}`, selected); }}
      onExportReport={format => { void run(() => exportReport(format), props.copy.reportFailed); }}
      onDelete={(id) => { void run(async () => {
        await shell.deleteArchive(id);
        props.onChanged(true);
      }, props.copy.archiveSaveFailed); }}
      onPatch={patch}
      onSaveMetadata={savePatch}
      onOpenSource={(url) => { void run(() => shell.openExternal(url), props.copy.archiveSourceOpenFailed); }}
      pendingSynthesis={props.pendingSynthesis}
      synthesisCandidate={props.synthesisCandidate}
      synthesisSession={props.synthesisSession}
      editorFocusOrigin={editorFocusOrigin}
      detailOverride={synthesisId && selected?.id === synthesisId ? <SynthesisWorkspace key={`${selected.id}:${followUpHost ?? "synthesis"}`} followUpHost={followUpHost} copy={props.copy} record={selected} sites={props.synthesisSites} defaultTier={props.defaultTier} busy={blocked} initialDraft={synthesisSeed ?? props.synthesisDrafts?.restore(selected, followUpHost)} onDraftChange={draft => props.synthesisDrafts?.save(selected, draft, followUpHost)} onReloadSource={reloadSource} onSourceReviewed={() => props.synthesisDrafts?.review(selected, followUpHost)} onCancel={() => { if (busy) shell.cancelSynthesis(); else setSynthesisId(null); }} onSend={(request, receipt) => { return run(() => props.onSendSynthesis(request, receipt), (error) => describeSynthesisSendCode(props.copy, errorCode(error))); }} /> : undefined}
      onSynthesize={() => requestDecisionNavigation(() => { setEditorFocusOrigin('synthesis'); setSynthesisSeed(null); setFollowUpHost(undefined); setSynthesisId(selected.id); })}
      onFollowUp={(host, value) => value ? excerpts.followUp(value) : requestDecisionNavigation(() => { setEditorFocusOrigin(`follow-up:${host}`); setSynthesisSeed(null); setFollowUpHost(host); setSynthesisId(selected.id); })}
      onCollectSynthesis={() => { void run(props.onCollectSynthesis, props.copy.synthesisCollectFailed); }}
      onSaveSynthesis={(replaceExisting) => { void run(async () => {
        const record = await props.onSaveSynthesis(replaceExisting);
        props.onSavedArchive(record);
        setStatus(props.copy.synthesisSavedDone);
      }, props.copy.archiveSaveFailed); }}
    />{excerpts.dialog}{markdownExport.panel}</>
  );
}
