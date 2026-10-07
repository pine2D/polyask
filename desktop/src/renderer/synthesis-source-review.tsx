import { useEffect, useRef, useState } from 'react';
import type { ArchiveRecord } from '../shared/archive';
import type { DesktopCopy } from '../shared/copy';
import { answerSourceId } from '../shared/answer-source';
import { selectedSynthesisAnswers } from '../shared/synthesis';
import { FolderModal } from './folder-modal';

export function SynthesisSourceReview(props: {
  readonly copy: DesktopCopy;
  readonly record: ArchiveRecord;
  readonly selectedHosts: readonly string[];
  readonly busy: boolean;
  readonly changed: boolean;
  readonly excerpt?: string;
  readonly onReload?: () => Promise<ArchiveRecord | null>;
  readonly onReviewed: () => void;
}): React.JSX.Element | null {
  const [review, setReview] = useState<ArchiveRecord | null>(null), [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const mounted = useRef(false), epoch = useRef(0), latest = useRef(props);
  latest.current = props;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; epoch.current++; }; }, [props.record.id]);
  const reload = async () => {
    const request = ++epoch.current, id = props.record.id;
    setLoading(true); setMessage('');
    try {
      const record = props.onReload ? await props.onReload() : props.record;
      if (!mounted.current || request !== epoch.current || latest.current.record.id !== id || latest.current.busy) return;
      if (!record || record.id !== id) setMessage(props.copy.excerptSourceMissing); else setReview(record);
    } catch { if (mounted.current && request === epoch.current) setMessage(props.copy.archiveLoadFailed); }
    finally { if (mounted.current && request === epoch.current) setLoading(false); }
  };
  if (!props.changed) return null;
  const selected = review ? selectedSynthesisAnswers(review.results, props.selectedHosts) : [];
  const valid = review?.updatedAt === props.record.updatedAt && selected.length === props.selectedHosts.length
    && (props.excerpt === undefined || (selected.length === 1 && !!props.excerpt.trim() && selected[0].text!.includes(props.excerpt)));
  return <>
    <p className="synthesis-source-changed" role="status">{props.copy.synthesisSourceChanged}</p>
    <button className="source-review-open" type="button" disabled={props.busy || loading} onClick={() => { void reload(); }}>{props.copy.synthesisReviewSource}</button>
    {message ? <p role="status">{message}</p> : null}
    {review ? <FolderModal copy={props.copy} title={props.copy.synthesisReviewSource} busy={props.busy} onCancel={() => setReview(null)}>
      <div className="source-review-dialog">
        <p>{props.copy.synthesisReviewHint}</p>
        {selected.map(result => <section key={result.host}><h3>{answerSourceId(review.results.indexOf(result))} {result.label}</h3>
          {result.code === 'answer_truncated' ? <p className="answer-capture-warning">{props.copy.answerTruncated}</p> : null}<pre>{result.text}</pre></section>)}
        {!valid ? <p role="status">{props.copy.excerptSourceInvalid}</p> : null}
        <button type="button" disabled={props.busy || !valid} onClick={() => { setReview(null); props.onReviewed(); }}>{props.copy.synthesisUseReviewed}</button>
      </div>
    </FolderModal> : null}
  </>;
}
