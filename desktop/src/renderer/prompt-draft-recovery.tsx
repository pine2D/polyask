import type { DesktopCopy } from '../shared/copy';
import { DraftRecovery } from './draft-recovery';
import type { DraftRecoveryState } from './use-persistent-draft';
import { SaveIcon } from './icons';

export function PromptDraftRecovery(props: { readonly copy: DesktopCopy; readonly recovery: DraftRecoveryState;
  readonly busy: boolean; readonly onClearImages: () => void; readonly onBlockingChange: (blocking: boolean) => void
}): React.JSX.Element {
  const copy = { ...props.copy, draftRestoreConfirm: `${props.copy.draftRestoreConfirm} ${props.copy.questionClearImages}` };
  return <DraftRecovery {...props.recovery} copy={copy} compact trigger={<SaveIcon />} dirty busy={props.busy}
    onBlockingChange={props.onBlockingChange} onRestore={async draft => {
      const accepted = await props.recovery.onRestore(draft);
      if (accepted !== false) props.onClearImages();
      return accepted;
    }} />;
}
