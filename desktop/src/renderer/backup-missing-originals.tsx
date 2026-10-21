import { useEffect, useRef } from 'react';
import type { BackupExportMode, BackupMissingOriginals } from '../shared/backup';
import { formatCopy, type DesktopCopy } from '../shared/copy';

export function BackupMissingOriginalsNotice({ missing, copy, busy, onExport, onCancel }: {
  missing: readonly BackupMissingOriginals[]; copy: DesktopCopy; busy: boolean;
  onExport: (mode: BackupExportMode) => void; onCancel: () => void;
}): React.JSX.Element {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, []);
  return <section className="backup-missing" aria-labelledby="backup-missing-title">
    <h3 id="backup-missing-title" tabIndex={-1} ref={heading}>{copy.backupMissingOriginals}</h3>
    <p>{copy.backupMissingHelp}</p>
    <ul>{missing.map(item => <li key={item.questionId}>
      <strong>{item.title}</strong>
      <p>{formatCopy(copy.backupMissingCount, { count: item.count })}</p>
      {item.images.length ? <p>{formatCopy(copy.backupKnownImages, { names: item.images.map(image => image.name).join(', ') })}</p> : null}
    </li>)}</ul>
    <div className="settings-actions">
      <button type="button" className="settings-control" disabled={busy} data-export-mode="download" onClick={() => onExport('download')}>{copy.backupDownloadOriginals}</button>
      <button type="button" className="settings-control" disabled={busy} data-export-mode="text-only" onClick={() => onExport('text-only')}>{copy.backupTextOnly}</button>
      <button type="button" className="settings-control" onClick={onCancel}>{copy.cancel}</button>
    </div>
  </section>;
}
