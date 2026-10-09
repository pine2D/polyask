import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { DesktopCopy } from '../shared/copy';
import type { DraftCopy } from '../shared/draft-copy';
import type { StoredDraft } from '../shared/drafts';
import type { DraftSaveStatus } from './draft-client';
import { FolderModal } from './folder-modal';

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
  readonly onBlockingChange?: (blocking: boolean) => void;
  readonly onRestore: (draft: StoredDraft) => boolean | void | Promise<boolean | void>;
  readonly onRemove: (draft: StoredDraft) => boolean | Promise<boolean>;
  readonly onRetry?: () => void;
}

function preview(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map(preview).filter(Boolean).join('\n\n');
  if (content && typeof content === 'object') return Object.entries(content).filter(([key]) =>
    !['id', 'archiveId', 'questionId', 'answerId', 'sourceId', 'sourceUpdatedAt', 'updatedAt', 'deviceId'].includes(key))
    .map(([, value]) => preview(value)).filter(Boolean).join('\n\n');
  return '';
}

/** The compact prompt entry uses the native surface owner's blocking callback. */
export function DraftRecovery(props: DraftRecoveryProps): React.JSX.Element {
  const { copy } = props, region = useId();
  const [open, setOpen] = useState(false), [selected, setSelected] = useState<StoredDraft | null>(null);
  const [confirmation, setConfirmation] = useState<'restore' | 'remove' | null>(null);
  const [working, setWorking] = useState(false), [message, setMessage] = useState('');
  const latestContext = useRef(props.contextKey); latestContext.current = props.contextKey;
  const cancel = useRef<HTMLButtonElement>(null), latestBlocking = useRef(props.onBlockingChange);
  latestBlocking.current = props.onBlockingChange;
  const busy = props.busy || working;
  const changed = selected !== null && props.sourceUpdatedAt !== undefined && selected.sourceUpdatedAt !== props.sourceUpdatedAt;
  const current = selected !== null && props.drafts.some(d => d.id === selected.id && d.updatedAt === selected.updatedAt);
  const blocked = !!props.compact && open;
  useEffect(() => {
    if (!blocked) return;
    latestBlocking.current?.(true);
    return () => latestBlocking.current?.(false);
  }, [blocked]);
  useEffect(() => { if (confirmation) cancel.current?.focus(); }, [confirmation]);
  useEffect(() => { setOpen(false); setSelected(null); setConfirmation(null); setMessage(''); }, [props.contextKey]);
  const close = () => { if (!busy) { setOpen(false); setSelected(null); setConfirmation(null); setMessage(''); } };
  const run = async (action: 'restore' | 'remove') => {
    if (!selected || !current || busy) return;
    const context = props.contextKey;
    setWorking(true); setMessage('');
    try {
      const accepted = action === 'restore' ? await props.onRestore(selected) : await props.onRemove(selected);
      if (latestContext.current !== context) return;
      if (accepted === false) setMessage(action === 'restore' ? copy.draftRestoreFailed : copy.draftRemoveFailed);
      else { setSelected(null); setConfirmation(null); if (action === 'restore') setOpen(false); }
    } catch { setMessage(action === 'restore' ? copy.draftRestoreFailed : copy.draftRemoveFailed); }
    finally { setWorking(false); setConfirmation(null); }
  };
  const status = props.status === 'loading' ? copy.draftLoading : props.status === 'saving' ? copy.draftSaving :
    props.status === 'saved' ? copy.draftSaved : props.status === 'error' ? copy.draftSaveFailed : '';
  const contents = <section className="draft-recovery" aria-label={copy.draftRecovery}>
    {status && <p role="status">{status}</p>}
    {props.status === 'error' && <button type="button" onClick={props.onRetry}>{copy.draftRetry}</button>}
    {!props.drafts.length && <p>{copy.draftNoCopies}</p>}
    <ul className="draft-copy-list">{props.drafts.map(draft => <li key={draft.id}>
      <span>{draft.title || copy.draftUntitled}</span>
      <small>{draft.deviceId.startsWith('backup:') ? copy.draftBackup : draft.deviceId === props.deviceId ? copy.draftLocal : copy.draftRemote}</small>
      <time dateTime={Number.isFinite(new Date(draft.updatedAt).getTime()) ? new Date(draft.updatedAt).toISOString() : undefined}>{Number.isFinite(new Date(draft.updatedAt).getTime()) ? new Date(draft.updatedAt).toLocaleString(props.locale) : copy.draftTimeUnavailable}</time>
      <button type="button" disabled={busy} onClick={() => { setSelected(draft); setConfirmation(null); setMessage(''); }}>{copy.draftReview}</button>
    </li>)}</ul>
    {selected && <section className="draft-preview" aria-labelledby={region}>
      <h3 id={region}>{copy.draftPreview}</h3><pre>{preview(selected.content) || copy.draftEmpty}</pre>
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
  return <><button type="button" data-draft-open data-draft-status={props.status} aria-label={label} data-hint={label} title={status || label} disabled={busy} onClick={() => setOpen(true)}>{props.trigger ?? label}</button>
    {status && <span className="sr-only" role="status">{status}</span>}
    {open && createPortal(<FolderModal copy={copy as DesktopCopy} title={copy.draftRecovery} busy={!!busy} onCancel={close}>{contents}</FolderModal>, document.body)}</>;
}
