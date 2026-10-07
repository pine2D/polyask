import type { DesktopCopy } from '../shared/copy';

export function SynthesisProgress(props: {
  readonly copy: DesktopCopy;
  readonly stage: 'submitted' | 'collected' | 'saved';
  readonly instruction: string;
}): React.JSX.Element {
  const message = props.stage === 'submitted' ? props.copy.analysisWaiting
    : props.stage === 'collected' ? props.copy.analysisReview : props.copy.analysisSaved;
  return <div className="analysis-progress" data-analysis-stage={props.stage}>
    <p role="status">{message}</p>
    <details className="analysis-requirement">
      <summary>{props.copy.analysisOriginalRequest}</summary>
      {props.instruction ? <pre>{props.instruction}</pre> : <p>{props.copy.analysisRequestMissing}</p>}
    </details>
  </div>;
}
