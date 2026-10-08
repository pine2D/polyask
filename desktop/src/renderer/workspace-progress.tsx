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
  const counts = runProgressCounts(props.runId, props.activeSites, props.statuses, props.progress);
  const total = props.activeSites.length, copy = props.copy;
  const facts = [
    ['submitted', copy.runSubmitted, counts.submitted, true], ['generating', copy.runGenerating, counts.generating, false],
    ['ended', copy.runEnded, counts.ended, true], ['complete', copy.runSavedComplete, counts.complete, true],
    ['partial', copy.runSavedPartial, counts.partial, false], ['failed', copy.runFailed, counts.failed, false],
    ['unconfirmed', copy.runUnconfirmed, counts.unconfirmed, false], ['cancelled', copy.runCancelled, counts.cancelled, false]
  ] as const;
  if (!props.runId || !workspaceHost) return null;
  return createPortal(<div className="run-progress" role="group" aria-label={copy.runProgressLabel} data-hint={copy.runProgressExplanation}>
    <div className="run-progress-facts">
      {facts.filter(([, , count, always]) => always || count > 0).map(([key, label, count]) =>
        <span data-progress={key} className={`run-progress-fact ${key}`} key={key}>{formatCopy(label, { count, total })}</span>)}
      {props.progress?.state === 'unavailable' && <span className="run-progress-fact">{copy.runCopiesUnavailable}</span>}
    </div>
    <button type="button" name="read-run-copies" disabled={!counts.hasReadableCopy || !props.progress?.questionId}
      onClick={props.onRead}>{copy.runReadCopies}</button>
  </div>, workspaceHost);
}
