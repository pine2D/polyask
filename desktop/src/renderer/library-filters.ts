import type { FolderFilters } from '../shared/task-folder';

export function changeFolderFilters(current: FolderFilters, patch: Partial<FolderFilters>): FolderFilters {
  const next = { ...current, ...patch };
  if (next.kind === 'decision') { delete next.tag; delete next.favorite; }
  if (next.kind === 'archive') delete next.status;
  return next;
}
