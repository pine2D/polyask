import assert from 'node:assert/strict';
import React, { act } from 'react';
import test from 'node:test';
import type { FolderContent } from '../src/shared/task-folder';
import { setShellApi } from '../src/renderer/shell-api';
import { getCopy } from '../src/shared/copy';
import { withFolderPages } from './ui/library-page-api';
import { mountLibrary, record, waitForInitial, waitForQuery, workspace } from './ui/library-test-host';

function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function setup(locale = 'en', background?: ReturnType<typeof deferred<readonly FolderContent[]>>) {
  const copy = getCopy(locale), recovered = { ...record, id: 'recovered', task: 'Recovered complete question' };
  let captures = 0, queries = 0, failLoad = false;
  let items: readonly FolderContent[] = [{ kind: 'archive', record }];
  const retry = deferred<typeof record>();
  setShellApi(withFolderPages({ listFolders: async () => [], listArchiveTags: async () => [],
    getArchive: async (id: string) => id === recovered.id ? recovered : record,
    searchFolderContents: async (filters: { query?: string }) => {
      queries++; if (filters.query === 'pending' && background) return background.promise;
      if (failLoad) { failLoad = false; throw Error('fixture_load_failed'); }
      return items;
    }
  }) as any);
  const h = await mountLibrary(workspace({ copy, locale, onCapture: async () => {
    captures++; if (captures === 1) throw Error('fixture_capture_failed');
    const value = await retry.promise; items = [{ kind: 'archive', record: value }]; return value;
  } }));
  await waitForInitial();
  return { ...h, copy, recovered, retry, get captures() { return captures; }, get queries() { return queries; },
    failNextLoad() { failLoad = true; },
    capture: () => [...h.document.querySelectorAll<HTMLButtonElement>('.folder-toolbar button')].find(b => b.textContent === copy.captureArchive)!,
    retryButton: () => h.document.querySelector<HTMLButtonElement>('.folder-workspace > .archive-status button')!,
    status: () => h.document.querySelector('.folder-workspace > .archive-status')?.textContent ?? '',
    async close() { await h.close(); setShellApi(null); }
  };
}

for (const locale of ['en', 'zh-CN', 'zh-TW']) test(locale + ': capture recovery retries only on explicit click and keeps failure on another rejection', async () => {
  const h = await setup(locale);
  try {
    await h.click(h.capture());
    assert.equal(h.captures, 1); assert.equal(h.status().includes(h.copy.archiveCollectFailed), true);
    await waitForInitial(); assert.equal(h.captures, 1, 'no automatic collection');
    const retry = h.retryButton(); await act(async () => { retry.click(); retry.click(); });
    assert.equal(h.captures, 2, 'error recovery invokes collection rather than list refresh');
    await h.click(h.capture()); assert.equal(h.captures, 2, 'the existing gate rejects duplicate activation');
    await act(async () => h.retry.reject(Error('fixture_capture_failed_again')));
    assert.equal(h.status().includes(h.copy.archiveCollectFailed), true);
    assert.equal(h.retryButton().disabled, false);
  } finally { await h.close(); }
});

test('successful capture retry opens its full saved result and clears the failure', async () => {
  const h = await setup();
  try {
    await h.click(h.capture()); await h.click(h.retryButton());
    assert.equal(h.captures, 2);
    await act(async () => h.retry.resolve(h.recovered)); await waitForInitial();
    assert.equal(h.document.querySelector('.archive-detail h1')?.textContent, h.recovered.task);
    assert.equal(h.status(), '');
  } finally { await h.close(); }
});

for (const reject of [false, true]) test('background list ' + (reject ? 'failure' : 'success') + ' preserves the capture recovery action', async () => {
  const background = deferred<readonly FolderContent[]>(), h = await setup('en', background);
  try {
    await h.input(h.document.querySelector<HTMLInputElement>('[name=library-search]')!, 'pending');
    await waitForQuery(); await h.click(h.capture());
    await act(async () => { if (reject) background.reject(Error('fixture_background_failed')); else background.resolve([{ kind: 'archive', record }]); });
    assert.equal(h.status().includes(h.copy.archiveCollectFailed), true);
    await h.click(h.retryButton()); assert.equal(h.captures, 2);
    await act(async () => h.retry.resolve(h.recovered));
  } finally { await h.close(); }
});

test('list recovery refreshes the list without collecting any answers', async () => {
  const h = await setup();
  try {
    h.failNextLoad();
    await h.input(h.document.querySelector<HTMLInputElement>('[name=library-search]')!, 'load-failure');
    await waitForQuery();
    assert.equal(h.status().includes(h.copy.folderLoadFailed), true);
    const before = h.queries; await h.click(h.retryButton()); await waitForQuery();
    assert.equal(h.queries > before, true); assert.equal(h.captures, 0); assert.equal(h.status(), '');
  } finally { await h.close(); }
});

test('an outstanding retry can finish after unmount without publishing new interface state', async () => {
  const h = await setup();
  let closed = false;
  try {
    await h.click(h.capture()); await h.click(h.retryButton()); assert.equal(h.captures, 2);
    await h.close(); closed = true;
    await act(async () => h.retry.resolve(h.recovered));
    assert.equal(h.captures, 2);
  } finally { if (!closed) await h.close(); }
});
