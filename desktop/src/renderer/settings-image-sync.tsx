import { useRef, useState } from 'react';
import type { DesktopCopy } from '../shared/copy';
import type { SyncStatus } from '../shared/sync';
import { ConfirmDialog } from './confirm-dialog';
import { shell } from './shell-api';

/** Independent from manual sync busy state: opting out is an immediate cancellation action. */
export function SettingsImageSync(props: {
  copy: DesktopCopy; status: SyncStatus; blocked: boolean;
  onStatus: (status: SyncStatus) => void; onFeedback: (message: string) => void;
}): React.JSX.Element {
  const [confirm, setConfirm] = useState(false), [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const setEnabled = async (enabled: boolean) => {
    if (inFlight.current || props.blocked) return;
    inFlight.current = true; setBusy(true); setConfirm(false);
    try {
      const status = await shell.setImageSyncEnabled(enabled, enabled);
      props.onStatus(status);
      props.onFeedback(status.imageSyncEnabled ? props.copy.imageSyncEnabled : props.copy.imageSyncDisabled);
    } catch { props.onFeedback(props.copy.syncActionFailed); }
    finally { inFlight.current = false; setBusy(false); }
  };
  return <>
    <label className="preference-card settings-image-sync">
      <span className="preference-copy"><strong id="question-image-sync-title" className="preference-title">{props.copy.imageSyncTitle}</strong>
        <p id="question-image-sync-description">{props.copy.imageSyncDescription}</p></span>
      <span className="preference-switch"><input type="checkbox" name="question-image-sync"
        aria-labelledby="question-image-sync-title" aria-describedby="question-image-sync-description"
        checked={props.status.imageSyncEnabled ?? false} disabled={busy || props.blocked}
        onChange={event => event.target.checked ? setConfirm(true) : void setEnabled(false)} /><span aria-hidden="true" /></span>
    </label>
    {confirm && !props.blocked ? <ConfirmDialog copy={props.copy} title={props.copy.imageSyncTitle} message={props.copy.imageSyncWarning}
      confirmLabel={props.copy.imageSyncConfirm} cancelLabel={props.copy.cancel} onCancel={() => setConfirm(false)} onConfirm={() => void setEnabled(true)} /> : null}
  </>;
}
