import type { BackupPreviewItem } from "../shared/backup";
import { formatCopy, type DesktopCopy } from "../shared/copy";
import { backupKind, BusinessData, businessBackupData, changedBackupFields } from './backup-data';
export { backupKind } from './backup-data';
export { initialBackupSelection, eligibleBackupSelection } from './backup-selection';

export function BackupComparison({ item, copy, selected, onSelect, locale = 'en', children }: {
  item: BackupPreviewItem; copy: DesktopCopy; selected: boolean; onSelect: (value: boolean) => void; locale?: string; children?: React.ReactNode;
}): React.JSX.Element {
  const changed = changedBackupFields(item.local, item.backup);
  const fields = item.status === 'conflict' ? changed : undefined;
  return <section className="backup-comparison" aria-label={item.title}>
    <header><span className="backup-muted">{backupKind(copy, item.kind)}</span><h3 tabIndex={-1}>{item.title}</h3></header>
    <div className="backup-choice">
      {item.blocked ? <p role="status">{copy.backupBlocked}</p> : item.status === "same" ? <p>{copy.backupSame}</p> : item.status === "conflict" ?
        <div className="backup-segments" role="group" aria-label={copy.backupReview}>
          <button type="button" aria-pressed={!selected} onClick={() => onSelect(false)}>{copy.backupKeepLocal}</button>
          <button type="button" aria-pressed={selected} onClick={() => onSelect(true)}>{copy.backupUseIncoming}</button>
        </div> : <label><input type="checkbox" checked={selected} onChange={(event) => onSelect(event.target.checked)} />{item.note === "folder_reused" ? copy.backupReuseFolder : item.status === "deleted" ? copy.backupRestoreDeleted : copy.backupInclude}</label>}
      {item.note === "question_new_identity" ? <p>{copy.backupQuestionRemap}</p> : null}
      {item.note === "folder_reused" ? <p>{copy.backupFolderReused}</p> : null}
      {item.note === "folder_new_identity" ? <p>{copy.backupFolderRemap}</p> : null}
      {item.note === "dependency_required" && !item.blocked ? <p>{copy.backupDependency}</p> : null}
    </div>
    {children}
    {item.status === 'conflict' ? <p className="backup-difference-count">{formatCopy(copy.backupChangedFields, { count: changed.size })}</p> : null}
    <div className="backup-versions">
      <section><h4>{copy.backupLocal}</h4>{item.local ? <BusinessData value={item.local} copy={copy} locale={locale} fields={fields} changed={fields} /> : <p>{copy.backupNoLocal}</p>}</section>
      <section><h4>{copy.backupIncoming}</h4><BusinessData value={item.backup} copy={copy} locale={locale} fields={fields} changed={fields} /></section>
    </div>
    {fields ? <details className="backup-full-versions"><summary>{copy.backupFullVersions}</summary><div className="backup-complete-versions"><section><h4>{copy.backupLocal}</h4><BusinessData value={item.local} copy={copy} locale={locale} /></section><section><h4>{copy.backupIncoming}</h4><BusinessData value={item.backup} copy={copy} locale={locale} /></section></div></details> : null}
    <details className="backup-raw-data"><summary>{copy.backupRawData}</summary><pre>{JSON.stringify(businessBackupData({ local: item.local, backup: item.backup }), null, 2)}</pre></details>
  </section>;
}
