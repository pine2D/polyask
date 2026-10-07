import type { FolderContent } from '../shared/task-folder';
import { contentKey } from './library-list-model';

export function matchingSelection(keys: readonly string[], items: readonly FolderContent[]): readonly string[] {
  const live = new Set(items.map(contentKey));
  return keys.filter(key => live.has(key));
}
export function toggleLibrarySelection(keys: readonly string[], key: string): readonly string[] {
  return keys.includes(key) ? keys.filter(value => value !== key) : [...keys, key];
}
export function selectLibraryPage(keys: readonly string[], items: readonly FolderContent[]): readonly string[] {
  return [...new Set([...keys, ...items.map(contentKey)])];
}
