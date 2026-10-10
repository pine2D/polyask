import { withFolderPages } from './ui/library-page-api';
import assert from 'node:assert/strict';
import test from 'node:test';
import { setShellApi } from '../src/renderer/shell-api';
import { mountDom } from './ui/dom-harness';
import { archiveItems, record, waitForInitial, waitForQuery, workspace } from './ui/library-test-host';

function stub(getArchive: (id: string) => Promise<any>) {
  const calls = { folders: 0, tags: 0, read: 0 };
  const all = archiveItems(150);
  setShellApi(withFolderPages({
    listFolders: async () => { calls.folders++; return []; }, listArchiveTags: async () => { calls.tags++; return []; },
    getArchive: (id: string) => { calls.read++; return getArchive(id); },
    searchFolderContents: async () => all,
  }) as any);
  return calls;
}

test('turning a page does not refetch folders, tags or the selected full text', async () => {
  const calls = stub(async (id: string) => ({ ...record, id }));
  const h = await mountDom(workspace({ preferredId: null }));
  try {
    await waitForInitial();
    await h.click(h.document.querySelector<HTMLButtonElement>('[data-action="library-open-item"]')!);
    const before = { ...calls };
    await h.click(h.document.querySelector<HTMLButtonElement>('[data-action="library-next-page"]')!);
    await waitForInitial();
    assert.equal(calls.folders, before.folders);
    assert.equal(calls.tags, before.tags);
    assert.equal(calls.read, before.read);
  } finally { await h.close(); setShellApi(null); }
});

test('a failing detail read keeps the list usable instead of marking it failed', async () => {
  let fail = false;
  stub(async (id: string) => { if (fail) throw new Error('detail'); return { ...record, id }; });
  const h = await mountDom(workspace({ preferredId: null }));
  try {
    await waitForInitial();
    await h.click(h.document.querySelector<HTMLButtonElement>('[data-action="library-open-item"]')!);
    fail = true;
    await h.input(h.document.querySelector<HTMLInputElement>('[name="library-search"]')!, 'Result');
    await waitForQuery();
    assert.equal(h.document.querySelectorAll('[data-action="library-open-item"]').length > 0, true, 'list still rendered');
  } finally { await h.close(); setShellApi(null); }
});
