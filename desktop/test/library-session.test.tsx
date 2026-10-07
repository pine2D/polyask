import assert from 'node:assert/strict';
import React, { act } from 'react';
import test from 'node:test';
import type { FolderContent, FolderFilters } from '../src/shared/task-folder';
import { setShellApi } from '../src/renderer/shell-api';
import { mountDom } from './ui/dom-harness';
import { button, copy, folder, record, readerTitle, sessionFixture, waitForInitial, waitForQuery, workspace } from './ui/library-test-host';

const content: FolderContent = { kind: 'archive', record };
function api(search: (filters: FolderFilters) => Promise<readonly FolderContent[]> = async () => [content]) {
  setShellApi({ listFolders: async () => [folder], listArchiveTags: async () => ['research'],
    searchFolderContents: search, getArchive: async () => record } as any);
}

test('matching query keeps the reader during the request and applies the newest record', async () => {
  let finish: ((items: readonly FolderContent[]) => void) | undefined;
  api(filters => filters.query ? new Promise(resolve => { finish = resolve; }) : Promise.resolve([content]));
  const h = await mountDom(workspace());
  try {
    await waitForInitial(); assert.equal(readerTitle(h.document), record.task);
    await h.input(h.document.querySelector<HTMLInputElement>('[name="library-search"]')!, 'sky');
    assert.equal(readerTitle(h.document), record.task, 'pending filters preserve current reading');
    await waitForQuery();
    await act(async () => finish!([{ kind: 'archive', record: { ...record, task: 'Newest sky result', updatedAt: 2_000 } }]));
    assert.equal(readerTitle(h.document), 'Newest sky result');
    assert.equal(h.document.querySelector('.library')?.getAttribute('data-pane'), 'detail');
  } finally { await h.close(); setShellApi(null); }
});

test('changing folder and favorites retains matching reading without losing the chosen folder', async () => {
  api(); const h = await mountDom(workspace());
  try {
    await waitForInitial();
    await h.click([...h.document.querySelectorAll<HTMLButtonElement>('.folder-sidebar nav button')].find(node => node.querySelector('.library-folder-name')?.textContent === folder.name)!);
    await waitForInitial(); assert.equal(readerTitle(h.document), record.task);
    await h.click(button(h.document, '.library-favorite')); await waitForInitial();
    assert.equal(readerTitle(h.document), record.task);
    assert.equal(h.document.querySelector('.folder-sidebar [aria-current="page"] .library-folder-name')?.textContent, folder.name);
    assert.equal(h.document.querySelector('.library-favorite')?.getAttribute('aria-pressed'), 'true');
  } finally { await h.close(); setShellApi(null); }
});

test('a failed query retains the reader and exposes failure rather than clearing it as empty', async () => {
  api(async filters => { if (filters.query) throw new Error('fixture_read_failure'); return [content]; });
  const h = await mountDom(workspace());
  try {
    await waitForInitial(); await h.input(h.document.querySelector<HTMLInputElement>('[name="library-search"]')!, 'sky');
    await waitForQuery(); assert.equal(readerTitle(h.document), record.task);
    assert.equal(h.document.querySelector('.archive-status')?.textContent?.includes(copy.folderLoadFailed), true);
    assert.equal(h.document.querySelector<HTMLInputElement>('[name="library-search"]')?.value, 'sky');
  } finally { await h.close(); setShellApi(null); }
});

test('an older empty query cannot clear reading restored by a newer matching result', async () => {
  const finishes = new Map<string, (items: readonly FolderContent[]) => void>();
  api(filters => filters.query ? new Promise(resolve => finishes.set(filters.query!, resolve)) : Promise.resolve([content]));
  const h = await mountDom(workspace());
  try {
    await waitForInitial(); const search = h.document.querySelector<HTMLInputElement>('[name="library-search"]')!;
    await h.input(search, 'old'); await waitForQuery(); await h.input(search, 'sky'); await waitForQuery();
    await act(async () => finishes.get('sky')!([{ kind: 'archive', record: { ...record, task: 'Matching newest sky', updatedAt: 2_000 } }]));
    await act(async () => finishes.get('old')!([]));
    assert.equal(readerTitle(h.document), 'Matching newest sky'); assert.equal(search.value, 'sky');
  } finally { await h.close(); setShellApi(null); }
});

test('only the latest successful nonmatching result clears the reader', async () => {
  let finish: ((items: readonly FolderContent[]) => void) | undefined;
  api(filters => filters.query ? new Promise(resolve => { finish = resolve; }) : Promise.resolve([content]));
  const h = await mountDom(workspace());
  try {
    await waitForInitial(); await h.input(h.document.querySelector<HTMLInputElement>('[name="library-search"]')!, 'absent');
    await waitForQuery(); assert.equal(readerTitle(h.document), record.task);
    await act(async () => finish!([])); assert.equal(readerTitle(h.document), null);
    assert.equal(h.document.querySelector('.library')?.getAttribute('data-pane'), 'list');
  } finally { await h.close(); setShellApi(null); }
});

test('canceling an unsaved metadata navigation retains filters, reader and draft', async () => {
  api(); const h = await mountDom(workspace());
  try {
    await waitForInitial(); h.document.querySelector<HTMLDetailsElement>('.archive-metadata')!.open = true;
    await h.input(h.document.querySelector<HTMLTextAreaElement>('[name="archive-note"]')!, 'Unsaved local notes');
    await h.input(h.document.querySelector<HTMLInputElement>('[name="library-search"]')!, 'sky');
    assert.equal(h.document.querySelector('.confirm-dialog[role="dialog"]') !== null, true);
    const cancel = [...h.document.querySelectorAll<HTMLButtonElement>('.confirm-dialog button')].find(node => node.textContent === copy.cancel)!;
    await h.click(cancel); assert.equal(readerTitle(h.document), record.task);
    assert.equal(h.document.querySelector<HTMLInputElement>('[name="library-search"]')?.value, '');
    assert.equal(h.document.querySelector<HTMLTextAreaElement>('[name="archive-note"]')?.value, 'Unsaved local notes');
  } finally { await h.close(); setShellApi(null); }
});

test('returning to the library restores filters and selection from IDs while fetching fresh records', async () => {
  const session = sessionFixture({ filters: { folderId: 'work', query: 'sky' }, selectedKey: `archive:${record.id}`, pane: 'detail', listScroll: 87 });
  const queries: FolderFilters[] = []; api(async filters => { queries.push(filters); return [{ kind: 'archive', record: { ...record, task: 'Fresh restored sky', updatedAt: 3_000 } }]; });
  const h = await mountDom(workspace({ preferredId: null, session }));
  try {
    await waitForQuery(); assert.equal(h.document.querySelector<HTMLInputElement>('[name="library-search"]')?.value, 'sky');
    assert.equal(readerTitle(h.document), 'Fresh restored sky');
    assert.equal(queries.at(-1)?.folderId, 'work');
    assert.equal(h.document.querySelector<HTMLElement>('.archive-list')?.scrollTop, 87);
  } finally { await h.close(); setShellApi(null); }
});

test('an explicit repeated same-ID navigation revision wins over the previous query', async () => {
  api(); const h = await mountDom(workspace({ navigationRevision: 1 }));
  try {
    await waitForInitial(); await h.input(h.document.querySelector<HTMLInputElement>('[name="library-search"]')!, 'sky'); await waitForQuery();
    await h.render(workspace({ navigationRevision: 2 })); await waitForInitial();
    assert.equal(h.document.querySelector<HTMLInputElement>('[name="library-search"]')?.value, '');
    assert.equal(readerTitle(h.document), record.task);
    assert.equal(h.document.querySelector('.library')?.getAttribute('data-pane'), 'detail');
  } finally { await h.close(); setShellApi(null); }
});
