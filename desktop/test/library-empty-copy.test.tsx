import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import test from 'node:test';
import { LibraryContentList } from '../src/renderer/library-content-list';
import { getCopy } from '../src/shared/copy';
import type { FolderFilters } from '../src/shared/task-folder';

for (const locale of ['en', 'zh-CN', 'zh-TW']) {
  const copy = getCopy(locale);
  for (const [name, filters, hint] of [
    ['first capture', {}, copy.libraryEmptyHint],
    ['unfiled capture', { folderId: '__unfiled__' }, copy.libraryEmptyHint],
    ['first decision', { kind: 'decision' }, copy.libraryDecisionEmptyHint],
    ['unfiled decision', { folderId: '__unfiled__', kind: 'decision' }, copy.libraryDecisionEmptyHint],
    ['empty folder', { folderId: 'work' }, copy.libraryFolderEmptyHint],
    ['decisions in a folder', { folderId: 'work', kind: 'decision' }, copy.libraryFolderEmptyHint],
    ['search', { query: 'missing' }, copy.libraryNoMatchesHint],
    ['filtered folder', { folderId: 'work', kind: 'decision', status: 'final' }, copy.libraryNoMatchesHint]
  ] as const) {
    test(`${locale}: empty ${name} offers a relevant next step`, () => {
      const html = renderToStaticMarkup(<LibraryContentList copy={copy} locale={locale} items={[]} filters={filters as FolderFilters}
        tags={[]} loading={false} failed={false} selectedKey={null} onChange={() => {}} onRetry={() => {}} onSelect={() => {}} />);
      assert.equal(html.includes(`<small>${hint}</small>`), true);
      if (hint !== copy.libraryEmptyHint) assert.equal(html.includes(copy.libraryEmptyHint), false);
    });
  }
}
