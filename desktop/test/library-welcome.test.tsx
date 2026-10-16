import assert from 'node:assert/strict';
import React, { act } from 'react';
import test from 'node:test';
import { getCopy } from '../src/shared/copy';
import type { FolderContent } from '../src/shared/task-folder';
import { setShellApi } from '../src/renderer/shell-api';
import { mountDom } from './ui/dom-harness';
import { withFolderPages } from './ui/library-page-api';
import { record, sessionFixture, waitForInitial, waitForQuery, workspace } from './ui/library-test-host';

for (const [locale, empty, noMatches, viewEmpty] of [
  ['en', 'No saved content yet', 'No matching content', 'No content in this view'],
  ['zh-CN', '尚未保存内容', '没有匹配的内容', '当前范围内没有内容'],
  ['zh-TW', '尚未儲存內容', '沒有符合的內容', '目前範圍內沒有內容']
] as const) {
  test(`${locale}: library arrival distinguishes empty, filtered and unselected content`, async () => {
    const copy = getCopy(locale); let contents: readonly FolderContent[] = [];
    setShellApi(withFolderPages({ listFolders: async () => [], listArchiveTags: async () => [], searchFolderContents: async () => contents }) as any);
    const h = await mountDom(workspace({ copy, locale, preferredId: null, session: sessionFixture() }));
    const title = () => h.document.querySelector('.library-welcome h1')?.textContent;
    try {
      await waitForInitial(); assert.equal(title(), empty);
      const search = h.document.querySelector<HTMLInputElement>('[name="library-search"]')!;
      await h.input(search, 'absent'); await waitForQuery(); assert.equal(title(), noMatches);
      await h.input(search, ''); await waitForQuery();
      await h.click([...h.document.querySelectorAll<HTMLButtonElement>('.library-segments button')].find(node => node.textContent === copy.libraryCards)!);
      await waitForInitial(); assert.equal(title(), viewEmpty, 'an empty content type does not claim the entire library is empty');
      contents = [{ kind: 'archive', record }];
      await h.click([...h.document.querySelectorAll<HTMLButtonElement>('.library-segments button')].find(node => node.textContent === copy.libraryAll)!);
      await waitForInitial(); assert.equal(title(), copy.libraryPick);
    } finally { await h.close(); setShellApi(null); }
  });
}

test('pending and failed library loads never masquerade as an empty library', async () => {
  let finish: ((items: readonly FolderContent[]) => void) | undefined;
  let fail = false;
  setShellApi(withFolderPages({ listFolders: async () => [], listArchiveTags: async () => [], searchFolderContents: async () => {
    if (fail) throw Error('fixture_load_failed');
    return new Promise<readonly FolderContent[]>(resolve => { finish = resolve; });
  } }) as any);
  const copy = getCopy('en'), h = await mountDom(workspace({ preferredId: null, session: sessionFixture() }));
  const title = () => h.document.querySelector('.library-welcome h1')?.textContent;
  try {
    assert.equal(title(), copy.archiveLoading);
    await waitForInitial(); await act(async () => finish!([]));
    assert.equal(title(), 'No saved content yet');
    fail = true; await h.input(h.document.querySelector<HTMLInputElement>('[name="library-search"]')!, 'fail');
    await waitForQuery(); assert.equal(title(), copy.folderLoadFailed);
  } finally { await h.close(); setShellApi(null); }
});
