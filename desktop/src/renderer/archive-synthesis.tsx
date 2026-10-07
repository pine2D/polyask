import { useEffect, useState } from "react";

import type { ArchiveRecord } from "../shared/archive";
import type { DesktopCopy } from "../shared/copy";
import type { PendingSynthesis, SynthesisCandidate } from "../shared/synthesis";
import { SparklesIcon } from "./icons";
import { MarkdownPreview } from "./markdown-preview";
import { formatDateTime } from '../shared/format';
import { SynthesisProgress } from './synthesis-progress';
import { matchingSynthesisSession, type SynthesisSession } from './synthesis-session';

interface ArchiveSynthesisProps {
  readonly onOpenLink?: (url: string) => void;
  readonly copy: DesktopCopy;
  readonly record: ArchiveRecord;
  readonly pending: PendingSynthesis | null;
  readonly candidate: SynthesisCandidate | null;
  readonly busy: boolean;
  readonly onCollect: () => void;
  readonly onSave: (replaceExisting: boolean) => void;
  readonly locale?: string;
  readonly session?: SynthesisSession | null;
}

export function ArchiveSynthesis(props: ArchiveSynthesisProps): React.JSX.Element | null {
  const { copy, record } = props;
  const [replaceArmed, setReplaceArmed] = useState(false);
  useEffect(() => setReplaceArmed(false), [record.id, props.candidate]);
  const pending = props.pending?.archiveId === record.id ? props.pending : null;
  const candidate = pending ? props.candidate : null;
  const session = matchingSynthesisSession(props.session, pending);
  if (!record.synthesis && !pending) return null;
  const requestSave = () => {
    if (!record.synthesis) props.onSave(false);
    else if (replaceArmed) props.onSave(true);
    else setReplaceArmed(true);
  };
  return (
    <section className="archive-synthesis">
      {record.synthesis ? (
        <div className="synthesis-card saved">
          <header><h2>{copy.analysisSaved}</h2><span>{record.synthesis.host}{record.synthesis.state ? ` · ${record.synthesis.state === "think" ? copy.think : copy.fast}` : ""}</span><time dateTime={new Date(record.synthesis.createdAt).toISOString()}>{formatDateTime(record.synthesis.createdAt, props.locale ?? 'en')}</time></header>
          <SynthesisProgress copy={copy} stage="saved" instruction={record.synthesis.instruction} />
          <p className="citation-notice">{copy.citationReportNotice}</p>
          <MarkdownPreview onOpenLink={props.onOpenLink} value={record.synthesis.text} />
        </div>
      ) : null}
      {pending ? (
        <div className="synthesis-card pending">
          <header><h2><SparklesIcon />{session?.purpose === 'followUp' ? copy.followUpTitle : session?.purpose === 'synthesis' ? copy.synthesisTitle : copy.analysisTitle}</h2><span>{pending.targetHost}{pending.tier ? ` · ${pending.tier === 'think' ? copy.think : copy.fast}` : ''}</span><time dateTime={new Date(pending.sentAt).toISOString()}>{formatDateTime(pending.sentAt, props.locale ?? 'en')}</time></header>
          <SynthesisProgress copy={copy} stage={candidate ? 'collected' : 'submitted'} instruction={pending.instruction} />
          {session?.sourceUpdatedAt !== undefined && session.sourceUpdatedAt !== record.updatedAt ? <p className="answer-capture-warning">{copy.analysisSourceChanged}</p> : null}
          {candidate ? <p className="citation-notice">{copy.citationReportNotice}</p> : null}
          {candidate ? <MarkdownPreview onOpenLink={props.onOpenLink} value={candidate.text} /> : null}
          {candidate ? (
            <div className="synthesis-confirm">
              {replaceArmed ? <><span>{copy.synthesisReplaceConfirm}</span><button type="button" disabled={props.busy} onClick={() => setReplaceArmed(false)}>{copy.cancelDelete}</button></> : null}
              <button type="button" className={replaceArmed ? "danger" : ""} disabled={props.busy} onClick={requestSave}>{record.synthesis ? copy.synthesisReplace : copy.synthesisSave}</button>
              <button type="button" disabled={props.busy} onClick={props.onCollect}>{copy.analysisCollectAgain}</button>
            </div>
          ) : <button type="button" disabled={props.busy} onClick={props.onCollect}>{copy.synthesisCollect}</button>}
        </div>
      ) : null}
    </section>
  );
}
