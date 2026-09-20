import { useState } from "react";

import type { ArchivePatch, ArchiveRecord } from "../shared/archive";
import type { DesktopCopy } from "../shared/copy";
import type { PendingSynthesis, SynthesisCandidate } from "../shared/synthesis";
import { formatDateTime } from "../shared/format";
import { ArchiveDetail } from "./archive-detail";
import { ConfirmDialog } from './confirm-dialog';
import { LibraryMenu } from './library-menu';
import {
  ArchiveIcon,
  CloseIcon,
  StarIcon
} from "./icons";

interface ArchiveWorkspaceProps {
  readonly embedded?: boolean;
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
  readonly onCreateDecision?: () => void;
  readonly onClose: () => void;
  readonly onQueryChange: (value: string) => void;
  readonly onFavoriteFilterChange: (value: boolean) => void;
  readonly onTagChange: (value: string) => void;
  readonly onSelect: (id: string) => void;
  readonly onCapture: () => void;
  readonly onCopy: () => void;
  readonly onExport: () => void;
  readonly onDelete: (id: string) => void;
  readonly onPatch: (patch: ArchivePatch) => void;
  readonly onOpenSource: (url: string) => void;
  readonly pendingSynthesis: PendingSynthesis | null;
  readonly synthesisCandidate: SynthesisCandidate | null;
  readonly detailOverride?: React.ReactNode;
  readonly onSynthesize: () => void;
  readonly onFollowUp?: (host: string) => void;
  readonly onCollectSynthesis: () => void;
  readonly onSaveSynthesis: (replaceExisting: boolean) => void;
}

export function ArchiveWorkspace(props: ArchiveWorkspaceProps): React.JSX.Element {
  const { copy, selected } = props;
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
          {!props.embedded ? <button type="button" title={copy.closeArchive} aria-label={copy.closeArchive} disabled={props.busy} onClick={props.onClose}><CloseIcon /></button> : null}
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
        <main className="archive-detail-pane">
          {props.detailOverride ?? (selected ? <ArchiveDetail onCreateDecision={props.onCreateDecision} initialComparisonOpen={selected.id === props.comparisonId} copy={copy} locale={props.locale} record={selected} onPatch={props.onPatch} onOpenSource={props.onOpenSource} pendingSynthesis={props.pendingSynthesis} synthesisCandidate={props.synthesisCandidate} busy={props.busy} onSynthesize={props.onSynthesize} onFollowUp={props.onFollowUp} onCollectSynthesis={props.onCollectSynthesis} onSaveSynthesis={props.onSaveSynthesis} /> : null)}
        </main>
      </div>
      <div className="archive-status" role="status" aria-live="polite">{props.status}</div>
      {confirmDelete === selected?.id && selected ? <ConfirmDialog copy={copy} title={copy.deleteArchive} message={copy.confirmDeleteArchive}
        confirmLabel={copy.deleteArchive} cancelLabel={copy.cancel} onCancel={() => setConfirmDelete(null)}
        onConfirm={() => { setConfirmDelete(null); props.onDelete(selected.id); }} /> : null}
    </section>
  );
}
