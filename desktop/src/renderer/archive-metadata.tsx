import { useEffect, useState } from 'react';
import type { ArchivePatch, ArchiveRecord } from '../shared/archive';
import type { DesktopCopy } from '../shared/copy';
import { ConfirmDialog } from './confirm-dialog';
import { registerDecisionNavigationGuard } from './decision-navigation';

export function ArchiveMetadata({ record, copy, busy, onSave }: {
  record: ArchiveRecord; copy: DesktopCopy; busy: boolean; onSave: (patch: ArchivePatch) => Promise<boolean>;
}): React.JSX.Element {
  const savedTags = record.tags.join(', ');
  const [tags, setTags] = useState(savedTags);
  const [note, setNote] = useState(record.note);
  const [confirm, setConfirm] = useState<(() => void) | null>(null);
  const dirty = tags !== savedTags || note !== record.note;
  useEffect(() => { setTags(savedTags); setNote(record.note); }, [record.id, savedTags, record.note]);
  useEffect(() => {
    if (!dirty) return;
    const unregister = registerDecisionNavigationGuard(action => setConfirm(() => action));
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', beforeUnload);
    return () => { unregister(); window.removeEventListener('beforeunload', beforeUnload); };
  }, [dirty]);
  return <>
    <details className="archive-metadata">
      <summary><span>{copy.libraryMetadata}</span><span className="library-metadata-preview">{record.tags.join(' / ') || record.note}</span>{dirty ? <small>{copy.decisionUnsaved}</small> : null}</summary>
      <form onSubmit={event => { event.preventDefault(); if (!busy && dirty) void onSave({ tags: tags.split(/[,，]/).map(tag => tag.trim()).filter(Boolean), note }); }}>
        <div className="archive-fields">
          <label>{copy.archiveTags}<input name="archive-tags" autoComplete="off" value={tags} disabled={busy} onChange={event => setTags(event.target.value)} /></label>
          <label>{copy.archiveNote}<textarea name="archive-note" autoComplete="off" maxLength={4000} value={note} disabled={busy} onChange={event => setNote(event.target.value)} /></label>
        </div>
        <div className="library-metadata-actions"><button type="submit" disabled={!dirty || busy}>{busy ? copy.librarySaving : copy.librarySaveMetadata}</button>
          {dirty ? <button type="button" disabled={busy} onClick={() => { setTags(savedTags); setNote(record.note); }}>{copy.cancel}</button> : null}
        </div>
      </form>
    </details>
    {confirm ? <ConfirmDialog copy={copy} title={copy.libraryMetadata} message={copy.decisionDiscard}
      confirmLabel={copy.decisionConfirm} cancelLabel={copy.cancel} onCancel={() => setConfirm(null)}
      onConfirm={() => { const action = confirm; setConfirm(null); setTags(savedTags); setNote(record.note); action(); }} /> : null}
  </>;
}
