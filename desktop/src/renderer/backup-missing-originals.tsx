import { useEffect, useRef } from 'react';
import type { BackupExportMode, BackupMissingOriginals } from '../shared/backup';
import { formatCopy, type DesktopCopy } from '../shared/copy';
import type { SyncStatus } from '../shared/sync';
import { syncNeedsReauthorization } from './sync-overview';

export function BackupMissingOriginalsNotice({ missing, copy, busy, syncStatus, onOpenSync, onExport, onCancel }: {
  missing: readonly BackupMissingOriginals[]; copy: DesktopCopy; busy: boolean;
  syncStatus: SyncStatus; onOpenSync: (target: "connection" | "images") => void;
  onExport: (mode: BackupExportMode) => void; onCancel: () => void;
}): React.JSX.Element {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, []);
  const needsConnection = !syncStatus.connected || syncNeedsReauthorization(syncStatus);
  const needsSettings = needsConnection || !syncStatus.imageSyncEnabled;
  return <section className="backup-missing" aria-labelledby="backup-missing-title">
    <h3 id="backup-missing-title" tabIndex={-1} ref={heading}>{copy.backupMissingOriginals}</h3>
    <p>{copy.backupMissingHelp}</p>
    <ul tabIndex={0} aria-labelledby="backup-missing-title">{missing.map(item => <li key={item.questionId}>
      <strong>{item.title}</strong>
      <p>{formatCopy(copy.backupMissingCount, { count: item.count })}</p>
      {item.images.length ? <p>{formatCopy(copy.backupKnownImages, { names: item.images.map(image => image.name).join(', ') })}</p> : null}
    </li>)}</ul>
    {needsSettings && <p id="backup-download-help">{needsConnection ? copy.backupDownloadNeedsConnection : copy.backupDownloadNeedsImageSync}</p>}
    <div className="settings-actions">
      {needsSettings ? <button type="button" className="settings-control" disabled={busy} aria-describedby="backup-download-help"
        onClick={() => onOpenSync(needsConnection ? 'connection' : 'images')}>{needsConnection ? copy.backupGoConnection : copy.backupGoImageSync}</button>
        : <button type="button" className="settings-control" disabled={busy} data-export-mode="download" onClick={() => onExport('download')}>{copy.backupDownloadOriginals}</button>}
      <button type="button" className="settings-control" disabled={busy} data-export-mode="text-only" onClick={() => onExport('text-only')}>{copy.backupTextOnly}</button>
      <button type="button" className="settings-control" onClick={onCancel}>{copy.cancel}</button>
    </div>
  </section>;
}
