import type { DesktopCopy } from '../shared/copy';
import { answerSourceId } from '../shared/answer-source';
import type { ExactExcerpt } from './answer-excerpt';
import { FolderModal } from './folder-modal';

export function ExcerptReplacementDialog(props: {
  readonly copy: DesktopCopy;
  readonly message: string;
  readonly previous: string;
  readonly selected: ExactExcerpt;
  readonly busy?: boolean;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
}): React.JSX.Element {
  return <FolderModal copy={props.copy} title={props.copy.excerptReplaceTitle} busy={props.busy ?? false} onCancel={props.onCancel}>
    <p>{props.message}</p><strong>{answerSourceId(props.selected.resultIndex)} {props.selected.label}</strong>
    <section data-excerpt-preview="previous"><h3>{props.copy.excerptPrevious}</h3><pre>{props.previous}</pre></section>
    <section data-excerpt-preview="selected"><h3>{props.copy.excerptSelected}</h3><pre>{props.selected.excerpt}</pre></section>
    <button type="button" disabled={props.busy} onClick={props.onConfirm}>{props.copy.excerptReplaceConfirm}</button>
  </FolderModal>;
}
