import { useEffect } from "react";

import type { ArchivePatch, ArchiveRecord } from "../shared/archive";
import { formatCopy, type DesktopCopy } from "../shared/copy";
import type { PendingSynthesis, SynthesisCandidate } from "../shared/synthesis";
import { formatDateTime } from "../shared/format";
import { describeCollectionCode } from "../shared/status-copy";
import { requestDecisionNavigation } from "./decision-navigation";
import { ArchiveMetadata } from "./archive-metadata";
import { ArchiveCompare } from "./archive-compare";
import { ArchiveSynthesis } from "./archive-synthesis";
import { CompareIcon, SparklesIcon, StarIcon } from "./icons";
import { MarkdownPreview } from "./markdown-preview";
import { answerSourceId } from "../shared/answer-source";
import type { LibraryReadingFocus } from './library-reading-focus';
import { ArchiveAnswerReading } from './archive-answer-reading';
import { excerptSource, type ExactExcerpt } from './answer-excerpt';
import type { SynthesisSession } from './synthesis-session';
import type { ComparisonDraftStore } from './comparison-draft-store';
import type { DecisionInput } from '../shared/decision';
import { useArchiveReader, type ArchiveReaderBinding } from './archive-reader-session';

interface ArchiveDetailProps {
  readonly reader?: ArchiveReaderBinding;
  readonly copy: DesktopCopy;
  readonly locale: string;
  readonly initialComparisonOpen?: boolean;
  readonly readingFocus?: LibraryReadingFocus;
  readonly comparisonDrafts?: ComparisonDraftStore;
  readonly onCreateDecisionDraft?: (record: ArchiveRecord, draft: DecisionInput) => void;
  readonly record: ArchiveRecord;
  readonly onSaveMetadata?: (patch: ArchivePatch) => Promise<boolean>;
  readonly onPatch: (patch: ArchivePatch) => void;
  readonly onOpenSource: (url: string) => void;
  readonly pendingSynthesis: PendingSynthesis | null;
  readonly synthesisCandidate: SynthesisCandidate | null;
  readonly synthesisSession?: SynthesisSession | null;
  readonly busy: boolean;
  readonly onCreateDecision?: (excerpt?: ExactExcerpt) => void;
  readonly onSynthesize: () => void;
  readonly onFollowUp?: (host: string, excerpt?: ExactExcerpt) => void;
  readonly onCollectSynthesis: () => void;
  readonly onSaveSynthesis: (replaceExisting: boolean) => void;
}

export function ArchiveDetail(props: ArchiveDetailProps): React.JSX.Element {
  const { copy, record } = props;
  const localReader = useArchiveReader(record, props.initialComparisonOpen);
  const reader = props.reader ?? localReader, view = reader.state.view;
  const setView = (value: typeof view) => reader.change({ view: value });
  useEffect(() => { if (props.pendingSynthesis?.archiveId === record.id) setView('synthesis'); }, [record.id, props.pendingSynthesis?.archiveId]);
  const favoriteLabel = record.favorite ? copy.unfavoriteArchive : copy.favoriteArchive;
  const successfulResults = record.results.filter((result) => !!result.text?.trim());
  const canSynthesize = successfulResults.length >= 2;
  return (
    <article className="archive-detail" data-view={view}>
      <header className="archive-detail-heading">
        <div>
          <h1>{record.task || record.text}</h1>
          <time dateTime={new Date(record.ts).toISOString()}>
            {formatCopy(copy.archiveCapturedAt, { time: formatDateTime(record.ts, props.locale) })}
          </time>
          {record.source ? <button type="button" className="archive-source" title={record.source.url} onClick={() => props.onOpenSource(record.source!.url)}>{copy.archiveSource}: {record.source.title || record.source.url}</button> : null}
        </div>
        <div className="archive-detail-actions">
          <button type="button" className={record.favorite ? 'active' : ''} title={favoriteLabel} aria-label={favoriteLabel} aria-pressed={record.favorite} disabled={props.busy} onClick={() => requestDecisionNavigation(() => props.onPatch({ favorite: !record.favorite }))}><StarIcon /></button>
        </div>
      </header>
      <div className="library-record-actions">
        {canSynthesize ? <button type="button" disabled={props.busy} onClick={props.onSynthesize}><SparklesIcon />{copy.synthesisAction}</button> : null}
        {props.onCreateDecision ? <button type="button" disabled={props.busy} onClick={() => props.onCreateDecision?.()}>{copy.decisionCreate}</button> : null}
      </div>
      <ArchiveMetadata record={record} copy={copy} busy={props.busy} onSave={props.onSaveMetadata ?? (async patch => { props.onPatch(patch); return true; })} />
      <nav className="library-view-switch" aria-label={copy.libraryAnswers}>
        <button type="button" aria-pressed={view === 'read'} onClick={() => setView('read')}>{copy.libraryRead}<span>{record.results.length}</span></button>
        {canSynthesize ? <button type="button" aria-pressed={view === 'compare'} onClick={() => setView('compare')}><CompareIcon />{copy.libraryCompare}</button> : null}
        <button type="button" aria-pressed={view === 'synthesis'} onClick={() => setView('synthesis')}>{copy.librarySynthesis}{record.synthesis ? <span aria-hidden="true">✓</span> : null}</button>
      </nav>
      {view === 'compare' ? <ArchiveCompare reader={reader} comparisonDrafts={props.comparisonDrafts} onCreateDecisionDraft={props.onCreateDecisionDraft} record={record} onEvidence={props.onCreateDecision} onFollowUp={props.onFollowUp} readingFocus={props.readingFocus} busy={props.busy} copy={copy} results={successfulResults} onOpenLink={props.onOpenSource} /> : null}
      {view === 'read' ? <div>
      <nav className="archive-answer-nav" aria-label={copy.siteViews}>
        {record.results.map((result, index) => <a key={`${result.host}:${index}`} href={`#archive-answer-${index}`}>{answerSourceId(index)} {result.label}</a>)}
      </nav>
      <div className="archive-answers">
        {record.results.map((result, index) => {
          const successful = !!result.text?.trim();
          const best = record.winnerHost === result.host;
          const tier = result.state === "think" ? ` · ${copy.think}` : result.state === "fast" ? ` · ${copy.fast}` : "";
          return (
            <section className="archive-answer" id={`archive-answer-${index}`} key={`${result.host}:${index}`}>
              <header><h2>{answerSourceId(index)} {result.label}{tier}</h2>{successful ? <button type="button" aria-label={best ? copy.unmarkBest : copy.markBest} aria-pressed={best} disabled={props.busy} onClick={() => props.onPatch({ winnerHost: best ? null : result.host })}>{best ? <StarIcon /> : null}<span>{best ? copy.unmarkBest : copy.markBest}</span></button> : null}</header>
              {successful && props.onFollowUp ? <button type="button" disabled={props.busy} onClick={() => props.onFollowUp?.(result.host)}>{copy.followUpAction}</button> : null}
              {successful && result.code === "answer_truncated" ? <p className="answer-capture-warning">{copy.answerTruncated}</p> : null}
              {successful ? <ArchiveAnswerReading copy={copy} source={excerptSource(record, index)!} busy={props.busy} onEvidence={props.onCreateDecision} onFollowUp={props.onFollowUp ? excerpt => props.onFollowUp?.(result.host, excerpt) : undefined}>
                <MarkdownPreview onOpenLink={props.onOpenSource} value={result.text!} />
              </ArchiveAnswerReading> : <MarkdownPreview onOpenLink={props.onOpenSource} value={`> ${describeCollectionCode(copy, result.code)}`} />}
            </section>
          );
        })}
      </div>
      </div> : null}
      {view === 'synthesis' ? <div>
      {!record.synthesis && props.pendingSynthesis?.archiveId !== record.id ? <p className="library-empty">{copy.libraryNoSynthesis}</p> : null}
      <ArchiveSynthesis locale={props.locale} session={props.synthesisSession} onOpenLink={props.onOpenSource} copy={copy} record={record} pending={props.pendingSynthesis} candidate={props.synthesisCandidate} busy={props.busy} onCollect={props.onCollectSynthesis} onSave={props.onSaveSynthesis} />
      </div> : null}
    </article>
  );
}
