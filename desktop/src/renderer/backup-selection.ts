import type { BackupPreviewItem } from '../shared/backup';

export function initialBackupSelection(items: readonly BackupPreviewItem[]): Set<string> {
  return new Set(items.filter(item => item.status === 'new' && !item.blocked).map(item => item.key));
}

export function eligibleBackupSelection(items: readonly BackupPreviewItem[], selected: ReadonlySet<string>): Set<string> {
  const byKey = new Map(items.map(item => [item.key, item]));
  const ready = (key: string, path: ReadonlySet<string> = new Set()): boolean => {
    const item = byKey.get(key);
    if (!item || item.blocked || !selected.has(key) || path.has(key)) return false;
    const next = new Set(path).add(key);
    return (item.requires ?? []).every(dependency => ready(dependency, next));
  };
  return new Set(items.filter(item => {
    if (!ready(item.key) || item.note === 'folder_reused' || item.reusesIdentity) return false;
    if (item.status !== 'same') return true;
    return item.note === 'question_new_identity' && items.some(answer => answer.kind === 'questionAnswer'
      && answer.backup.questionId === item.id && answer.status === 'deleted' && selected.has(answer.key));
  }).map(item => item.key));
}

export function backupDependencyPlan(items: readonly BackupPreviewItem[], selected: ReadonlySet<string>, item: BackupPreviewItem) {
  const byKey = new Map(items.map(entry => [entry.key, entry]));
  const add = new Set<string>(), deleted = new Set<string>(), missing = new Set<string>(), visited = new Set<string>();
  const visit = (key: string) => {
    if (visited.has(key)) return;
    visited.add(key);
    const dependency = byKey.get(key);
    if (!dependency || dependency.blocked) { missing.add(key); return; }
    if (!selected.has(key)) {
      if (dependency.status === 'deleted') deleted.add(key);
      else add.add(key);
    }
    for (const child of dependency.requires ?? []) visit(child);
  };
  for (const key of item.requires ?? []) visit(key);
  if (item.source && !item.source.available && byKey.has(item.source.key)) visit(item.source.key);
  return { add, deleted, missing };
}

export function visibleBackupSelection(visible: readonly BackupPreviewItem[], selected: ReadonlySet<string>, include: boolean): Set<string> {
  const next = new Set(selected);
  for (const item of visible) {
    if (!include) next.delete(item.key);
    else if (!item.blocked && (item.status === 'new' || item.status === 'conflict')) next.add(item.key);
  }
  return next;
}

export function backupSkipCounts(items: readonly BackupPreviewItem[], selected: ReadonlySet<string>, eligible: ReadonlySet<string>) {
  const counts = { unselected: 0, same: 0, dependency: 0, blocked: 0 };
  for (const item of items) {
    if (eligible.has(item.key)) continue;
    if (item.blocked) counts.blocked++;
    else if (item.status === 'same' || item.note === 'folder_reused' || item.reusesIdentity) counts.same++;
    else if (!selected.has(item.key)) counts.unselected++;
    else counts.dependency++;
  }
  return counts;
}
