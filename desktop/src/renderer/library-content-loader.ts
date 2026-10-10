import { isFolderTarget, type FolderContent, type FolderTarget } from '../shared/task-folder';
import { shell } from './shell-api';

export function targetFromContentKey(key: string | null): FolderTarget | null {
  if (!key) return null;
  const colon = key.indexOf(':'), target = { kind: key.slice(0, colon), id: key.slice(colon + 1) };
  return isFolderTarget(target) ? target : null;
}
export async function readFolderContent(target: FolderTarget): Promise<FolderContent | null> {
  if (target.kind === 'archive') {
    const record = await shell.getArchive(target.id);
    return record ? { kind: 'archive', record } : null;
  }
  const record = await shell.getDecision(target.id);
  return record ? { kind: 'decision', record } : null;
}
