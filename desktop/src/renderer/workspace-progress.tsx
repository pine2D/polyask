import { useId, useState } from 'react';
import { createPortal } from 'react-dom';
import type { DesktopCopy } from '../shared/copy';
import type { SiteKey } from '../shared/contracts';
import type { SiteStatus } from '../shared/protocol';
import { useGlobalFeedback } from './feedback-provider';
import type { QuestionRunProgress } from '../shared/question-run-progress';
import { formatCopy } from '../shared/copy';
import { runProgressCounts } from './run-progress-model';

export interface WorkspaceProgressProps {
  readonly copy: DesktopCopy;
  readonly statuses: Readonly<Record<string, SiteStatus>>;
  readonly runId: string | null;
  readonly activeSites: readonly SiteKey[];
  readonly progress: QuestionRunProgress | null;
  readonly onRead: () => void;
}
export function WorkspaceProgress(props: WorkspaceProgressProps): React.JSX.Element | null {
  const { workspaceHost } = useGlobalFeedback();
  const [expanded, setExpanded] = useState(false), detailsId = useId();
  const counts = runProgressCounts(props.runId, props.activeSites, props.statuses, props.progress);
  const total = props.activeSites.length, copy = props.copy;
  const progress = props.progress?.runId === props.runId ? props.progress : null;
  const pending = total - counts.submitted - counts.failed - counts.unconfirmed - counts.cancelled;
  const stage = pending > 0 ? copy.runStageSending : counts.generating > 0 ? copy.runStageGenerating
    : counts.submitted > 0 && counts.complete === counts.submitted ? copy.runStageSaved
    : counts.submitted > 0 && counts.ended === counts.submitted ? copy.runStageEnded
    : counts.submitted > 0 ? copy.runStageWaiting : copy.runStageSettled;
  const facts = [
    ['unconfirmed', copy.runUnconfirmed, counts.unconfirmed, false], ['failed', copy.runFailed, counts.failed, false],
    ['cancelled', copy.runCancelled, counts.cancelled, false],
    ['submitted', copy.runSubmitted, counts.submitted, true], ['generating', copy.runGenerating, counts.generating, false],
    ['ended', copy.runEnded, counts.ended, true], ['complete', copy.runSavedComplete, counts.complete, true],
    ['partial', copy.runSavedPartial, counts.partial, false]
  ] as const;
  if (!props.runId || !workspaceHost) return null;
  return createPortal(<div className="run-progress" role="group" aria-label={copy.runProgressLabel} data-expanded={expanded}>
    <div className="run-progress-content">
      <div className="run-progress-summary" role="status" aria-live="polite" aria-atomic="true">
        <strong data-progress-stage>{stage}</strong>
        <span className="run-progress-summary-counts">{formatCopy(copy.runSubmitted, { count: counts.submitted, total })}
          <span>{formatCopy(copy.runEnded, { count: counts.ended, total })}</span>
          <span>{formatCopy(copy.runSavedComplete, { count: counts.complete, total })}</span></span>
        {(['unconfirmed', 'failed', 'cancelled'] as const).filter(key => counts[key] > 0).map(key =>
          <span className={`run-progress-fact ${key}`} data-progress-alert={key} key={key}
            title={key === 'unconfirmed' ? copy.runUnconfirmedHint : undefined}>
            {formatCopy(key === 'unconfirmed' ? copy.runUnconfirmed : key === 'failed' ? copy.runFailed : copy.runCancelled, { count: counts[key] })}</span>)}
        {progress?.state === 'unavailable' && <span className="run-progress-fact" data-progress-alert="unavailable">{copy.runCopiesUnavailable}</span>}
      </div>
      <div id={detailsId} className="run-progress-facts" aria-hidden={!expanded} tabIndex={expanded ? 0 : -1} aria-label={copy.runProgressLabel}>
      {facts.filter(([, , count, always]) => always || count > 0).map(([key, label, count]) =>
        <span data-progress={key} className={`run-progress-fact ${key}`} key={key}>{formatCopy(label, { count, total })}</span>)}
      {progress?.state === 'unavailable' && <span className="run-progress-fact">{copy.runCopiesUnavailable}</span>}
      <span className="sr-only">{copy.runProgressExplanation}{counts.unconfirmed > 0 ? ` ${copy.runUnconfirmedHint}` : ''}</span>
      </div>
    </div>
    <button type="button" name="run-progress-details" aria-expanded={expanded} aria-controls={detailsId}
      title={copy.runProgressExplanation} onClick={() => setExpanded(value => !value)}>{expanded ? copy.runProgressSummary : copy.runProgressDetails}</button>
    <button type="button" name="read-run-copies" aria-label={copy.runReadCopies} disabled={!counts.hasReadableCopy || !progress?.questionId}
      onClick={props.onRead}><span className="run-read-label">{copy.runReadCopies}</span><span className="run-read-compact" aria-hidden="true">{copy.runReadCompact}</span></button>
  </div>, workspaceHost);
}
