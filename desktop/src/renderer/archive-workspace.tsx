import { useLayoutEffect, useRef, useState } from "react";

import type { ArchivePatch, ArchiveRecord } from "../shared/archive";
import type { DesktopCopy } from "../shared/copy";
import type { PendingSynthesis, SynthesisCandidate } from "../shared/synthesis";
import { formatDateTime } from "../shared/format";
import { ArchiveDetail } from "./archive-detail";
import { ConfirmDialog } from './confirm-dialog';
import { LibraryMenu } from './library-menu';
import type { LibraryReadingFocus } from './library-reading-focus';
import type { ExactExcerpt } from './answer-excerpt';
import type { SynthesisSession } from './synthesis-session';
import type { ComparisonDraftStore } from './comparison-draft-store';
import type { DecisionInput } from '../shared/decision';
import { useArchiveReader, type ArchiveReaderBinding } from './archive-reader-session';
import {
  ArchiveIcon,
  CloseIcon,
  StarIcon
} from "./icons";

interface ArchiveWorkspaceProps {
  readonly reader?: ArchiveReaderBinding;
  readonly embedded?: boolean;
  readonly readingFocus?: LibraryReadingFocus;
  readonly comparisonDrafts?: ComparisonDraftStore;
  readonly onCreateDecisionDraft?: (record: ArchiveRecord, draft: DecisionInput) => void;
  readonly onOrganize?: () => void;
  readonly copy: DesktopCopy;
  readonly locale: string;
  readonly items: readonly ArchiveRecord[];
  readonly comparisonId?: string | null;
  readonly selected: ArchiveRecord | null;
  readonly tags: readonly string[];
  readonly query: string;
  readonly favoriteOnly: boolean;
  readonly selectedTag: string;
  readonly loading: boolean;
  readonly busy: boolean;
  readonly status: string;
  readonly onDecisions?: () => void;
  readonly onCreateDecision?: (excerpt?: ExactExcerpt) => void;
  readonly onClose: () => void;
  readonly onQueryChange: (value: string) => void;
  readonly onFavoriteFilterChange: (value: boolean) => void;
  readonly onTagChange: (value: string) => void;
  readonly onSelect: (id: string) => void;
  readonly onCapture: () => void;
  readonly onCopy: () => void;
  readonly onExport: () => void;
  readonly onDelete: (id: string) => void;
  readonly onSaveMetadata?: (patch: ArchivePatch) => Promise<boolean>;
  readonly onPatch: (patch: ArchivePatch) => void;
  readonly onOpenSource: (url: string) => void;
  readonly pendingSynthesis: PendingSynthesis | null;
  readonly synthesisCandidate: SynthesisCandidate | null;
  readonly synthesisSession?: SynthesisSession | null;
  readonly detailOverride?: React.ReactNode;
  readonly onSynthesize: () => void;
  readonly onFollowUp?: (host: string, excerpt?: ExactExcerpt) => void;
  readonly onCollectSynthesis: () => void;
  readonly onSaveSynthesis: (replaceExisting: boolean) => void;
}

export function ArchiveWorkspace(props: ArchiveWorkspaceProps): React.JSX.Element {
  const { copy, selected } = props;
  const localReader = useArchiveReader(selected ?? { id: '', results: [] }, selected?.id === props.comparisonId);
  const reader = props.reader ?? localReader;
  const pane = useRef<HTMLElement>(null);
  const capture = () => {
    if (!pane.current) return {};
    return props.detailOverride || reader.state.view === 'synthesis' ? { synthesisScroll: pane.current.scrollTop }
      : reader.state.view === 'read' ? { readScroll: pane.current.scrollTop } : {};
  };
  const change: ArchiveReaderBinding['change'] = patch => reader.change({ ...('view' in patch ? capture() : {}), ...patch });
  useLayoutEffect(() => {
    if (pane.current) pane.current.scrollTop = props.detailOverride || reader.state.view === 'synthesis' ? reader.state.synthesisScroll
      : reader.state.view === 'read' ? reader.state.readScroll : 0;
  }, [reader.state.archiveId, reader.state.view, !!props.detailOverride]);
  const emptyText = props.query || props.favoriteOnly || props.selectedTag
    ? copy.archiveNoMatches
    : copy.archiveEmpty;
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const actions = [
    { label: copy.copyArchive, run: props.onCopy },
    { label: copy.exportArchive, run: props.onExport },
    { label: copy.deleteArchive, run: () => setConfirmDelete(selected?.id ?? null), danger: true }
  ];
  return (
    <section className="archive-workspace" aria-label={copy.archiveTitle} aria-busy={props.busy}>
      <header className="archive-toolbar">
        {props.embedded ? <span className="library-record-kind">{copy.folderResults}</span> : null}
        {!props.embedded ? <div className="decision-tabs"><strong><ArchiveIcon />{copy.archiveTitle}</strong>{props.onDecisions ? <button type="button" disabled={props.busy} onClick={props.onDecisions}>{copy.decisionTitle}</button> : null}</div> : null}
        {!props.embedded ? <div className="archive-filters">
          <input type="search" name="archive-search" autoComplete="off" value={props.query} placeholder={copy.archiveSearch} aria-label={copy.archiveSearch} disabled={props.busy} onChange={(event) => props.onQueryChange(event.target.value)} />
          <button type="button" className={props.favoriteOnly ? "active" : ""} title={copy.favoriteArchives} aria-label={copy.favoriteArchives} aria-pressed={props.favoriteOnly} disabled={props.busy} onClick={() => props.onFavoriteFilterChange(!props.favoriteOnly)}><StarIcon /></button>
          <select name="archive-tag-filter" value={props.selectedTag} aria-label={copy.archiveTags} disabled={props.busy} onChange={(event) => props.onTagChange(event.target.value)}>
            <option value="">{copy.allArchiveTags}</option>
            {props.tags.map((tag) => <option value={tag} key={tag}>{tag}</option>)}
          </select>
        </div> : null}
        <div className="archive-actions">
          {!props.embedded ? <button type="button" title={copy.captureArchive} aria-label={copy.captureArchive} disabled={props.busy} onClick={props.onCapture}><ArchiveIcon /></button> : null}
          {props.onOrganize ? <button className="library-organize" type="button" disabled={props.busy} onClick={props.onOrganize}>{copy.libraryOrganize}</button> : null}
          <LibraryMenu label={copy.libraryMore} disabled={!selected || props.busy} actions={actions} />
          {!props.embedded ? <button className="panel-close" type="button" title={copy.closeArchive} aria-label={copy.closeArchive} disabled={props.busy} onClick={props.onClose}><CloseIcon /></button> : null}
        </div>
      </header>
      <div className="archive-body">
        {!props.embedded ? <aside className="archive-list" aria-label={copy.archiveTitle}>
          {props.loading || !props.items.length ? (
            <div className="archive-empty" role="status">
              {props.loading ? copy.archiveLoading : emptyText}
            </div>
          ) : (
            props.items.map((record) => (
              <button type="button" key={record.id} aria-current={record.id === selected?.id ? "true" : undefined} disabled={props.busy} onClick={() => props.onSelect(record.id)}>
                <time dateTime={new Date(record.ts).toISOString()}>{formatDateTime(record.ts, props.locale)}</time>
                <span>{record.task || record.preview || "—"}</span>
                <small>{record.results.map((result) => result.label).join(" · ")}</small>
                {record.favorite || record.tags.length ? <span className="archive-badges">{record.favorite ? <StarIcon /> : null}{record.tags.map((tag) => <i key={tag}>{tag}</i>)}</span> : null}
              </button>
            ))
          )}
        </aside> : null}
        <main ref={pane} className="archive-detail-pane" onScroll={event => { if (event.target === event.currentTarget) reader.change(capture()); }}>
          {props.detailOverride ?? (selected ? <ArchiveDetail reader={{ state: reader.state, change }} comparisonDrafts={props.comparisonDrafts} onCreateDecisionDraft={props.onCreateDecisionDraft} synthesisSession={props.synthesisSession} readingFocus={props.readingFocus} onSaveMetadata={props.onSaveMetadata} onCreateDecision={props.onCreateDecision} initialComparisonOpen={selected.id === props.comparisonId} copy={copy} locale={props.locale} record={selected} onPatch={props.onPatch} onOpenSource={props.onOpenSource} pendingSynthesis={props.pendingSynthesis} synthesisCandidate={props.synthesisCandidate} busy={props.busy} onSynthesize={props.onSynthesize} onFollowUp={props.onFollowUp} onCollectSynthesis={props.onCollectSynthesis} onSaveSynthesis={props.onSaveSynthesis} /> : null)}
        </main>
      </div>
      <div className="archive-status" role="status" aria-live="polite">{props.status}</div>
      {confirmDelete === selected?.id && selected ? <ConfirmDialog copy={copy} title={copy.deleteArchive} message={copy.confirmDeleteArchive}
        confirmLabel={copy.deleteArchive} cancelLabel={copy.cancel} onCancel={() => setConfirmDelete(null)}
        onConfirm={() => { setConfirmDelete(null); props.onDelete(selected.id); }} /> : null}
    </section>
  );
}
