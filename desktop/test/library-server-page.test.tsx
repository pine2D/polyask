import assert from 'node:assert/strict';
import test from 'node:test';
import { act } from 'react';
import { DesktopDatabase } from '../src/main/database';
import { createLocalDataServices } from '../src/main/local-data-services';
import { createArchiveRecord } from '../src/shared/archive';
import { setShellApi } from '../src/renderer/shell-api';
import { button, copy, mountLibrary, readerTitle, sessionFixture, waitForInitial, workspace } from './ui/library-test-host';

function fixture() {
  const db = DesktopDatabase.open(':memory:'), services = createLocalDataServices(db);
  for (let i = 0; i < 205; i++) db.archives.put(createArchiveRecord({ text: `Question ${i}`, task: `Result ${i}`,
    results: [{ host: 'claude.ai', label: 'Claude', text: 'Full answer '.repeat(300) }] },
    { id: `r${String(i).padStart(4, '0')}`, now: i + 1, deviceId: 'test' }), false);
  const reads: string[] = [], writes: string[] = [];
  setShellApi({ listFolders: async () => [], listArchiveTags: async () => [],
    searchFolderContents: async () => [],
    queryFolderContents: async (request: any) => (services.folders as any).query(request),
    getArchive: async (id: string) => { reads.push(id); return services.archives.get(id); },
    updateArchive: async (id: string, patch: any) => { writes.push(id); return services.archives.update(id, patch); },
    archiveMarkdown: async (id: string, locale: string) => services.archives.exportMarkdown(id, locale),
  } as any);
  return { db, services, reads, writes };
}

test('production workspace loads SQL summary pages and keeps selected IDs for a cross-page favorite operation', async () => {
  const f = fixture(), h = await mountLibrary(workspace({ preferredId: null }));
  try {
    await waitForInitial();
    assert.equal(h.document.querySelectorAll('.library-item-title').length, 100);
    assert.equal(f.reads.length, 0, 'summary browsing must not read any full archive');
    await h.click(button(h.document, '[data-action="library-select-page"]'));
    await h.click(button(h.document, '[data-action="library-next-page"]')); await waitForInitial();
    assert.equal(h.document.querySelector('.library-item-title')?.textContent, 'Result 104');
    assert.equal(h.document.querySelector('.library-selection-summary')?.textContent?.includes('100'), true);
    await h.click(h.document.querySelector<HTMLInputElement>('.library-row-check input')!);
    const favorite = [...h.document.querySelectorAll<HTMLButtonElement>('.library-bulk-actions button')].find(b => b.textContent?.includes('Favorite'))!;
    await h.click(favorite); await waitForInitial();
    assert.equal(f.writes.length, 101);
    assert.equal(f.services.archives.get('r0204')!.favorite, true);
    assert.equal(f.services.archives.get('r0104')!.favorite, true);
  } finally { await h.close(); setShellApi(null); f.db.close(); }
});

test('restoring an off-page reader fetches its full record by ID while keeping the saved page and list scroll', async () => {
  const f = fixture();
  const session = sessionFixture({ page: 1, listScroll: 37, selectedKey: 'archive:r0000', pane: 'detail' });
  const h = await mountLibrary(workspace({ preferredId: null, session }));
  try {
    await waitForInitial();
    assert.equal(readerTitle(h.document), 'Result 0');
    assert.equal(f.reads.join(','), 'r0000');
    assert.equal(h.document.querySelector('.library-item-title')?.textContent, 'Result 104');
    assert.equal(h.document.querySelector<HTMLElement>('.archive-list')?.scrollTop, 37);
    await h.click(button(h.document, '[data-action="library-open-item"]')); await waitForInitial();
    assert.equal(readerTitle(h.document), 'Result 104');
    assert.equal(f.reads.at(-1), 'r0104');
    assert.equal(h.document.querySelector('.archive-answer')?.textContent?.includes('Full answer'), true);
    assert.equal(copy.folderLoadFailed === h.document.querySelector('.archive-status')?.textContent, false);
  } finally { await h.close(); setShellApi(null); f.db.close(); }
});

test('a detail read completing after the old metadata became dirty asks again before replacing it', async () => {
  const f = fixture();
  let finish: (() => void) | undefined;
  setShellApi({ listFolders: async () => [], listArchiveTags: async () => [],
    queryFolderContents: async (request: any) => f.services.folders.query(request),
    getArchive: (id: string) => id === 'r0004' ? new Promise(resolve => { finish = () => resolve(f.services.archives.get(id)); })
      : Promise.resolve(f.services.archives.get(id)),
  } as any);
  const session = sessionFixture({ page: 2, selectedKey: 'archive:r0000', pane: 'detail' });
  const h = await mountLibrary(workspace({ preferredId: null, session }));
  try {
    await waitForInitial(); await h.click(button(h.document, '[data-action="library-open-item"]'));
    h.document.querySelector<HTMLDetailsElement>('.archive-metadata')!.open = true;
    await h.input(h.document.querySelector<HTMLTextAreaElement>('[name="archive-note"]')!, 'Typed during the detail read');
    await act(async () => finish!());
    assert.equal(h.document.querySelector('.confirm-dialog') !== null, true);
    assert.equal(readerTitle(h.document), 'Result 0');
    const cancel = [...h.document.querySelectorAll<HTMLButtonElement>('.confirm-dialog button')].find(b => b.textContent === copy.cancel)!;
    await h.click(cancel);
    assert.equal(h.document.querySelector<HTMLTextAreaElement>('[name="archive-note"]')?.value, 'Typed during the detail read');
  } finally { await h.close(); setShellApi(null); f.db.close(); }
});
