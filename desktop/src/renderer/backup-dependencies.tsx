import type { BackupPreviewItem } from '../shared/backup';
import { formatCopy, type DesktopCopy } from '../shared/copy';
import { backupKind } from './backup-data';
import { backupDependencyPlan, eligibleBackupSelection } from './backup-selection';

export function BackupDependencies({ item, items, selected, eligible, copy, onLocate, onAdd }: {
  item: BackupPreviewItem; items: readonly BackupPreviewItem[]; selected: ReadonlySet<string>; copy: DesktopCopy;
  eligible?: ReadonlySet<string>;
  onLocate: (key: string) => void; onAdd: (keys: ReadonlySet<string>) => void;
}): React.JSX.Element | null {
  const source = item.source;
  const keys = [...new Set([...(item.requires ?? []), ...(source ? [source.key] : [])])];
  if (!keys.length) return null;
  const byKey = new Map(items.map(entry => [entry.key, entry]));
  const plan = backupDependencyPlan(items, selected, item);
  const ready = eligible ?? eligibleBackupSelection(items, selected);
  return <section className="backup-dependencies" aria-label={copy.backupRequiredEntities}>
    <h4>{source && !(item.requires?.length) ? copy.decisionSource : copy.backupRequiredEntities}</h4>
    {source && !source.available && !ready.has(source.key) ? <p>{copy.backupSourceOptional}</p> : null}
    <ul>{keys.map(key => {
      const dependency = byKey.get(key);
      const availableSource = source?.key === key && source.available;
      const title = dependency?.title || (source?.key === key ? source.title : backupKind(copy, key.slice(0, key.indexOf(':'))));
      const state = availableSource ? copy.backupSourceAvailable : dependency?.blocked ? copy.backupDependencyBlocked
        : dependency?.note === 'folder_reused' && selected.has(key) ? copy.backupReuseFolder
        : ready.has(key) ? source?.key === key ? copy.backupSourceIncluded : copy.backupDependencySelected
          : dependency?.reusesIdentity && selected.has(key) ? copy.backupAlreadyRestored
          : selected.has(key) ? copy.backupWaitDependency
          : dependency?.status === 'deleted' ? copy.backupDependencyDeleted : !dependency ? copy.backupDependencyMissing : copy.backupSkipped;
      return <li key={key}>{dependency ? <button type="button" data-dependency-key={key} onClick={() => onLocate(key)}>{backupKind(copy, dependency.kind)} · {title}</button> : <strong>{title}</strong>}<span>{state}</span></li>;
    })}</ul>
    {plan.add.size || plan.deleted.size || plan.missing.size ? <p>{formatCopy(copy.backupDependencyImpact, { add: plan.add.size, deleted: plan.deleted.size, missing: plan.missing.size })}</p> : null}
    {plan.add.size > 0 ? <button type="button" className="backup-add-dependencies" onClick={() => onAdd(plan.add)}>{formatCopy(copy.backupAddDependencies, { count: plan.add.size })}</button> : null}
  </section>;
}
