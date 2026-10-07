import { useEffect, useId, useRef, useState } from 'react';
import type { ArchivePatch, ArchiveRecord } from '../shared/archive';
import type { DesktopCopy } from '../shared/copy';
import { formatCopy } from '../shared/copy';
import { ConfirmDialog } from './confirm-dialog';
import { registerDecisionNavigationGuard } from './decision-navigation';
import { validateArchiveTags } from './archive-metadata-validation';
export { validateArchiveTags } from './archive-metadata-validation';

export function ArchiveMetadata({ record, copy, busy, onSave }: {
  record: ArchiveRecord; copy: DesktopCopy; busy: boolean; onSave: (patch: ArchivePatch) => Promise<boolean>;
}): React.JSX.Element {
  const savedTags = record.tags.join(', ');
  const [tags, setTags] = useState(savedTags);
  const [note, setNote] = useState(record.note);
  const [confirm, setConfirm] = useState<(() => void) | null>(null);
  const [saving, setSaving] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [message, setMessage] = useState('');
  const pending = useRef(false);
  const tagsInput = useRef<HTMLInputElement>(null);
  const id = useId();
  const validation = validateArchiveTags(tags);
  const invalid = validation.tooMany || validation.overlongIndices.length > 0;
  const showErrors = attempt > 0 && invalid;
  const blocked = busy || saving;
  const dirty = tags !== savedTags || note !== record.note;
  useEffect(() => { setTags(savedTags); setNote(record.note); setAttempt(0); setMessage(''); }, [record.id, savedTags, record.note]);
  useEffect(() => { if (attempt) tagsInput.current?.focus(); }, [attempt]);
  useEffect(() => {
    if (!dirty) return;
    const unregister = registerDecisionNavigationGuard(action => setConfirm(() => action));
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', beforeUnload);
    return () => { unregister(); window.removeEventListener('beforeunload', beforeUnload); };
  }, [dirty]);
  const save = async () => {
    if (pending.current || blocked || !dirty) return;
    if (invalid) { setAttempt(value => value + 1); return; }
    pending.current = true; setSaving(true); setMessage('');
    try { if (!await onSave({ tags: validation.tags, note })) setMessage(copy.archiveMetadataSaveFailed); }
    catch { setMessage(copy.archiveMetadataSaveFailed); }
    finally { pending.current = false; setSaving(false); }
  };
  return <>
    <details className="archive-metadata">
      <summary><span>{copy.libraryMetadata}</span><span className="library-metadata-preview">{record.tags.join(' / ') || record.note}</span>{dirty ? <small>{copy.decisionUnsaved}</small> : null}</summary>
      <form aria-busy={saving} onSubmit={event => { event.preventDefault(); void save(); }}>
        <div className="archive-fields">
          <div className="archive-tags-field">
            <label htmlFor={`${id}-tags`}>{copy.archiveTags}</label>
            <input id={`${id}-tags`} ref={tagsInput} name="archive-tags" autoComplete="off" value={tags} disabled={blocked}
              aria-invalid={showErrors || undefined} aria-describedby={`${id}-hint ${id}-count${showErrors ? ` ${id}-error` : ''}`}
              onChange={event => setTags(event.target.value)} />
            <p id={`${id}-hint`} className="archive-field-hint">{copy.archiveTagsHint}</p>
            <p id={`${id}-count`} className="archive-field-hint">{formatCopy(copy.archiveTagsCount, { count: validation.tags.length })}</p>
            {validation.tags.length ? <ul className="archive-tag-counts">{validation.tags.map((tag, index) =>
              <li key={index} data-overlong={[...tag].length > 32 || undefined}><span>{tag}</span><span>{[...tag].length} / 32</span></li>
            )}</ul> : null}
            {showErrors ? <ul id={`${id}-error`} className="archive-field-errors">
              {validation.tooMany ? <li>{formatCopy(copy.archiveTagsTooMany, { count: validation.tags.length })}</li> : null}
              {validation.overlongIndices.map(index => <li key={index}>{formatCopy(copy.archiveTagTooLong, { index: index + 1 })}</li>)}
            </ul> : null}
          </div>
          <label>{copy.archiveNote}<textarea name="archive-note" autoComplete="off" maxLength={4000} value={note} disabled={blocked} onChange={event => setNote(event.target.value)} /></label>
        </div>
        <p role="status">{message}</p>
        <div className="library-metadata-actions"><button type="submit" disabled={!dirty || blocked}>{blocked ? copy.librarySaving : copy.librarySaveMetadata}</button>
          {dirty ? <button type="button" disabled={blocked} onClick={() => { setTags(savedTags); setNote(record.note); setAttempt(0); setMessage(''); }}>{copy.cancel}</button> : null}
        </div>
      </form>
    </details>
    {confirm ? <ConfirmDialog copy={copy} title={copy.libraryMetadata} message={copy.decisionDiscard}
      confirmLabel={copy.decisionConfirm} cancelLabel={copy.cancel} onCancel={() => setConfirm(null)}
      onConfirm={() => { const action = confirm; setConfirm(null); setTags(savedTags); setNote(record.note); action(); }} /> : null}
  </>;
}
