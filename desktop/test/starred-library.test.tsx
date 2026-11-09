import assert from 'node:assert/strict';
import { act } from 'react';
import test from 'node:test';
import type { FolderContent } from '../src/shared/task-folder';
import { setShellApi } from '../src/renderer/shell-api';
import { mountLibrary, workspace, record, decision, button, waitForInitial, waitForQuery } from './ui/library-test-host';
import { pageFolderContents } from './ui/library-page-api';

for (const kind of ['archive', 'decision'] as const) test(`${kind} star survives a stale detail read without opening another item`, async () => {
  const original = kind === 'archive' ? { ...record, favorite: false } : { ...decision, favorite: false };
  let current = original, finish!: (record: unknown) => void;
  const item = (): FolderContent => ({ kind, record: current } as FolderContent);
  const save = async () => current = { ...current, favorite: true, updatedAt: original.updatedAt + 1 };
  setShellApi({ listFolders: async () => [], listArchiveTags: async () => [],
    queryFolderContents: async (request: any) => pageFolderContents([item()], request),
    getArchive: async () => kind === 'archive' ? new Promise(resolve => { finish = resolve; }) : record,
    getDecision: async () => new Promise(resolve => { finish = resolve; }),
    updateArchive: save, setDecisionFavorite: save,
    listDrafts: async () => [], onDraftsChanged: () => () => {}, folderMemberships: async () => [],
  } as any);
  const h = await mountLibrary(workspace({ preferredId: null }));
  try {
    await waitForInitial();
    await h.click(button(h.document, '[data-action=library-open-item]'));
    await h.click(button(h.document, '.library-content-row [data-star-button]'));
    await act(async () => finish(original));
    const detail = kind === 'archive' ? '.archive-detail-actions .star-button' : '.decision-detail-actions [data-star-button]';
    assert.equal(button(h.document, detail).getAttribute('aria-pressed'), 'true');
    assert.equal(button(h.document, '.library-content-row [data-star-button]').getAttribute('aria-pressed'), 'true');
    assert.equal(h.document.querySelectorAll('[data-action=library-open-item]').length, 1);
  } finally { await h.close(); setShellApi(null); }
});

test('a star acknowledged during a filter read invalidates its stale result and refreshes the current query', async () => {
  let current = { ...record, favorite: false }, calls = 0;
  let oldQuery!: (page: unknown) => void, finish!: () => void;
  setShellApi({ listFolders: async () => [], listArchiveTags: async () => [],
    queryFolderContents: async (request: any) => {
      calls++;
      if (calls === 2) return new Promise(resolve => { oldQuery = resolve; });
      return pageFolderContents([{ kind: 'archive', record: current }], request);
    },
    updateArchive: async () => { await new Promise<void>(resolve => { finish = resolve; });
      return current = { ...current, favorite: true, updatedAt: current.updatedAt + 1 }; },
  } as any);
  const h = await mountLibrary(workspace({ preferredId: null }));
  try {
    await waitForInitial();
    await h.click(button(h.document, '.library-content-row [data-star-button]'));
    await h.input(h.document.querySelector<HTMLInputElement>('[name=library-search]')!, 'Question');
    await waitForQuery();
    await act(async () => finish());
    await waitForQuery();
    await act(async () => oldQuery(pageFolderContents([], { query: 'Question' })));
    assert.equal(calls, 3);
    assert.equal(button(h.document, '.library-content-row [data-star-button]').getAttribute('aria-pressed'), 'true');
    assert.equal(h.document.querySelector<HTMLInputElement>('[name=library-search]')!.value, 'Question');
  } finally { await h.close(); setShellApi(null); }
});
