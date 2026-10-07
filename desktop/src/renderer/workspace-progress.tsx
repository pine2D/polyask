import type { ComponentProps, ReactNode } from 'react';
import { PageTabs } from './page-tabs';
import type { QuestionRunProgress } from '../shared/question-run-progress';
import { formatCopy } from '../shared/copy';
import { WORKSPACE_PROGRESS_HEIGHT } from '../shared/display';
import { runProgressCounts } from './run-progress-model';

export interface WorkspaceProgressProps extends ComponentProps<typeof PageTabs> {
  readonly runId: string | null;
  readonly activeSites: ComponentProps<typeof PageTabs>['selectedSites'];
  readonly progress: QuestionRunProgress | null;
  readonly onRead: () => void;
  readonly idleControl?: ReactNode;
}
export function WorkspaceProgress(props: WorkspaceProgressProps): React.JSX.Element {
  const counts = runProgressCounts(props.runId, props.activeSites, props.statuses, props.progress);
  const total = props.activeSites.length, copy = props.copy;
  const facts = [
    ['submitted', copy.runSubmitted, counts.submitted, true], ['generating', copy.runGenerating, counts.generating, false],
    ['ended', copy.runEnded, counts.ended, true], ['complete', copy.runSavedComplete, counts.complete, true],
    ['partial', copy.runSavedPartial, counts.partial, false], ['failed', copy.runFailed, counts.failed, false],
    ['unconfirmed', copy.runUnconfirmed, counts.unconfirmed, false], ['cancelled', copy.runCancelled, counts.cancelled, false]
  ] as const;
  return <div className="workspace-progress" style={{ height: WORKSPACE_PROGRESS_HEIGHT }}>
    <PageTabs {...props} alwaysVisible showSiteNames summaryRunId={props.runId}/>
    {!props.runId && props.idleControl}
    {props.runId && <div className="run-progress" role="group" aria-label={copy.runProgressLabel} data-hint={copy.runProgressExplanation}>
      {facts.filter(([, , count, always]) => always || count > 0).map(([key, label, count]) =>
        <span data-progress={key} className={`run-progress-fact ${key}`} key={key}>{formatCopy(label, { count, total })}</span>)}
      {props.progress?.state === 'unavailable' && <span className="run-progress-fact">{copy.runCopiesUnavailable}</span>}
      <button type="button" name="read-run-copies" disabled={!counts.hasReadableCopy || !props.progress?.questionId}
        onClick={props.onRead}>{copy.runReadCopies}</button>
    </div>}
  </div>;
}
