import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { DesktopCopy } from '../shared/copy';
import type { DraftCopy } from '../shared/draft-copy';
import type { StoredDraft } from '../shared/drafts';
import type { DraftSaveStatus } from './draft-client';
import { FolderModal } from './folder-modal';
import { useDraftDialog, type DraftBlockingChange } from './use-draft-dialog';
import { DraftCopyBadge, DraftPreview } from './draft-preview';
import { sortDraftCopies } from './draft-preview-model';
import { formatDateTime } from '../shared/format';

export interface DraftRecoveryProps {
  readonly copy: DraftCopy & { cancel: string };
  readonly drafts: readonly StoredDraft[];
  readonly deviceId: string;
  readonly dirty?: boolean;
  readonly sourceUpdatedAt?: number;
  readonly compact?: boolean;
  readonly busy?: boolean;
  readonly status?: DraftSaveStatus;
  readonly locale?: string;
  readonly trigger?: React.ReactNode;
  readonly contextKey?: string;
  readonly onBlockingChange?: DraftBlockingChange;
  readonly onRestore: (draft: StoredDraft) => boolean | void | Promise<boolean | void>;
  readonly onRemove: (draft: StoredDraft) => boolean | Promise<boolean>;
  readonly onRetry?: () => void;
}

/** The compact prompt entry uses the native surface owner's blocking callback. */
export function DraftRecovery(props: DraftRecoveryProps): React.JSX.Element {
  const { copy } = props, region = useId();
  const { open, show, close: closeDialog } = useDraftDialog(props.compact, props.contextKey, props.onBlockingChange);
  const [selected, setSelected] = useState<StoredDraft | null>(null);
  const [confirmation, setConfirmation] = useState<'restore' | 'remove' | null>(null);
  const [working, setWorking] = useState(false), [message, setMessage] = useState('');
  const latestContext = useRef(props.contextKey); latestContext.current = props.contextKey;
  const runEpoch = useRef(0);
  const cancel = useRef<HTMLButtonElement>(null);
  const busy = props.busy || working;
  const changed = selected !== null && props.sourceUpdatedAt !== undefined && selected.sourceUpdatedAt !== props.sourceUpdatedAt;
  const current = selected !== null && props.drafts.some(d => d.id === selected.id && d.updatedAt === selected.updatedAt);
  useEffect(() => { if (confirmation) cancel.current?.focus(); }, [confirmation]);
  useEffect(() => {
    runEpoch.current++; setSelected(null); setConfirmation(null); setMessage(''); setWorking(false);
    return () => { runEpoch.current++; };
  }, [props.contextKey]);
  const close = () => { if (!busy) { closeDialog(); setSelected(null); setConfirmation(null); setMessage(''); } };
  const run = async (action: 'restore' | 'remove') => {
    if (!selected || !current || busy) return;
    const context = props.contextKey;
    const attempt = runEpoch.current, active = () => attempt === runEpoch.current && latestContext.current === context;
    setWorking(true); setMessage('');
    try {
      const accepted = action === 'restore' ? await props.onRestore(selected) : await props.onRemove(selected);
      if (!active()) return;
      if (accepted === false) setMessage(action === 'restore' ? copy.draftRestoreFailed : copy.draftRemoveFailed);
      else { setSelected(null); setConfirmation(null); if (action === 'restore') closeDialog(); }
    } catch { if (active()) setMessage(action === 'restore' ? copy.draftRestoreFailed : copy.draftRemoveFailed); }
    finally { if (active()) { setWorking(false); setConfirmation(null); } }
  };
  const status = props.status === 'loading' ? copy.draftLoading : props.status === 'saving' ? copy.draftSaving :
    props.status === 'saved' ? copy.draftSaved : props.status === 'error' ? copy.draftSaveFailed : '';
  const contents = <section className="draft-recovery" aria-label={copy.draftRecovery}>
    {status && <p role="status">{status}</p>}
    {props.status === 'error' && <button type="button" onClick={props.onRetry}>{copy.draftRetry}</button>}
    {!props.drafts.length && <p>{copy.draftNoCopies}</p>}
    <ul className="draft-copy-list">{sortDraftCopies(props.drafts).map(draft => <li key={draft.id}>
      <span>{draft.title || copy.draftUntitled}</span>
      <small>{draft.deviceId.startsWith('backup:') ? copy.draftBackup : draft.deviceId === props.deviceId ? copy.draftLocal : copy.draftRemote}</small>
      <time dateTime={Number.isFinite(new Date(draft.updatedAt).getTime()) ? new Date(draft.updatedAt).toISOString() : undefined}>{Number.isFinite(new Date(draft.updatedAt).getTime()) ? formatDateTime(draft.updatedAt, props.locale ?? navigator.language) : copy.draftTimeUnavailable}</time>
      <button type="button" disabled={busy} onClick={() => { setSelected(draft); setConfirmation(null); setMessage(''); }}>{copy.draftReview}</button>
    </li>)}</ul>
    {selected && <section className="draft-preview" aria-labelledby={region}>
      <h3 id={region}>{copy.draftPreview}</h3><DraftPreview kind={selected.kind} content={selected.content} copy={copy} />
      {changed && <p role="status">{copy.draftSourceChanged}</p>}
      {!current && <p role="status">{copy.draftReviewChanged}</p>}
      {message && <p role="status">{message}</p>}
      {confirmation ? <section className="draft-confirm" aria-label={confirmation === 'restore' ? copy.draftRestoreConfirm : copy.draftRemoveConfirm}>
        <p>{confirmation === 'restore' ? copy.draftRestoreConfirm : copy.draftRemoveConfirm}</p>
        {confirmation === 'remove' && <p>{copy.draftRemoveHint}</p>}
        <div className="confirm-actions"><button type="button" ref={cancel} disabled={busy} onClick={() => setConfirmation(null)}>{copy.draftKeepEditing}</button>
          <button type="button" className="primary" disabled={busy || !current} onClick={() => void run(confirmation)}>{confirmation === 'restore' ? copy.draftRestore : copy.draftRemove}</button></div>
      </section> : <div className="draft-actions">
        <button type="button" disabled={busy || !current} onClick={() => props.dirty || changed ? setConfirmation('restore') : void run('restore')}>{copy.draftRestore}</button>
        <button type="button" disabled={busy || !current} onClick={() => setConfirmation('remove')}>{copy.draftRemove}</button>
      </div>}
    </section>}
  </section>;
  if (!props.compact) return <details className="draft-recovery-entry"><summary>{copy.draftRecoveryCount.replace('{count}', String(props.drafts.length))}</summary>{contents}</details>;
  const label = copy.draftRecoveryCount.replace('{count}', String(props.drafts.length));
  return <><button type="button" className="draft-trigger" data-draft-open data-draft-status={props.status} aria-label={label} aria-expanded={open} aria-haspopup="dialog" data-hint={label} title={status || label} disabled={busy} onClick={show}>{props.trigger ?? label}{props.trigger ? <DraftCopyBadge count={props.drafts.length} /> : null}</button>
    {status && <span className="sr-only" role="status">{status}</span>}
    {open && createPortal(<FolderModal copy={copy as DesktopCopy} title={copy.draftRecovery} busy={!!busy} onCancel={close}>{contents}</FolderModal>, document.body)}</>;
}
