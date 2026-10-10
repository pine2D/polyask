import type { FolderContent, FolderTarget } from '../../src/shared/task-folder';
import { FOLDER_PAGE_SIZE, type FolderContentPage, type FolderPageRequest } from '../../src/shared/task-folder-page';
import { contentKey, sortLibraryContents } from '../../src/renderer/library-list-model';

/** Renderer fixtures emulate the page envelope; SQL behavior is separately exercised against a real database. */
export function pageFolderContents(items: readonly FolderContent[], request: FolderPageRequest): FolderContentPage {
  const ordered = sortLibraryContents(items, request.sort ?? 'updated-desc', request.locale ?? 'en');
  const selectedKey = request.selected ? `${request.selected.kind}:${request.selected.id}` : null;
  const index = selectedKey ? ordered.findIndex(item => contentKey(item) === selectedKey) : -1;
  const selectedPage = index < 0 ? null : Math.floor(index / FOLDER_PAGE_SIZE);
  const page = request.locateSelected ? selectedPage ?? 0
    : Math.min(request.page ?? 0, Math.max(0, Math.ceil(items.length / FOLDER_PAGE_SIZE) - 1));
  const live = new Set(ordered.map(contentKey));
  return { total: items.length, page, selected: index < 0 ? null : request.selected ?? null, selectedPage,
    selectedTargets: (request.selectedTargets ?? []).filter(target => live.has(`${target.kind}:${target.id}`)),
    items: ordered.slice(page * FOLDER_PAGE_SIZE, (page + 1) * FOLDER_PAGE_SIZE).map(item => item.kind === 'archive' ? {
      kind: 'archive', record: { id: item.record.id, task: [...item.record.task].slice(0, 512).join(''),
        preview: [...item.record.preview].slice(0, 320).join(''), createdAt: item.record.createdAt,
        updatedAt: item.record.updatedAt, ts: item.record.ts, favorite: item.record.favorite, tags: item.record.tags,
        results: item.record.results.map(result => ({ label: result.label })) },
    } : { kind: 'decision', record: { id: item.record.id, title: item.record.title, status: item.record.status,
      createdAt: item.record.createdAt, updatedAt: item.record.updatedAt } }) };
}

export function withFolderPages(api: Record<string, any>): Record<string, any> {
  let contents: readonly FolderContent[] = [];
  const record = async (target: FolderTarget) => {
    const getter = target.kind === 'archive' ? api.getArchive : api.getDecision;
    if (typeof getter === 'function') return getter.call(api, target.id);
    return contents.find(item => item.kind === target.kind && item.record.id === target.id)?.record ?? null;
  };
  return { ...api, queryFolderContents: async (request: FolderPageRequest) => {
    contents = await api.searchFolderContents(request);
    return pageFolderContents(contents, request);
  }, getArchive: (id: string) => record({ kind: 'archive', id }), getDecision: (id: string) => record({ kind: 'decision', id }) };
}
