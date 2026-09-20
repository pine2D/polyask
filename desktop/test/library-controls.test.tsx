import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import test from 'node:test';
import { LibrarySelect, nextEnabledOption } from '../src/renderer/library-select';
import { changeFolderFilters } from '../src/renderer/library-filters';

test('selection navigation skips disabled choices and wraps without selecting', () => {
  const options = [{ value: 'a', label: 'A' }, { value: 'b', label: 'B', disabled: true }, { value: 'c', label: 'C' }];
  assert.equal(nextEnabledOption(options, 0, 1), 2);
  assert.equal(nextEnabledOption(options, 2, 1), 0);
  assert.equal(nextEnabledOption(options, 0, -1), 2);
  assert.equal(nextEnabledOption([{ value: 'a', label: 'A', disabled: true }], 0, 1), -1);
});

test('select announces current value and has a separate accessible label', () => {
  const html = renderToStaticMarkup(<LibrarySelect label="Status" value="draft" options={[{ value: 'draft', label: 'Draft' }]} onChange={() => undefined} />);
  assert.match(html, /role="combobox"/);
  assert.match(html, /aria-label="Status"/);
  assert.match(html, /aria-expanded="false"/);
  assert.match(html, />Draft</);
});

test('switching content type removes filters that no longer apply', () => {
  assert.deepEqual(changeFolderFilters({ folderId: 'work', kind: 'archive', tag: 'x', favorite: true, query: 'q' }, { kind: 'decision' }), { folderId: 'work', kind: 'decision', query: 'q' });
  assert.deepEqual(changeFolderFilters({ kind: 'decision', status: 'draft' }, { kind: 'archive' }), { kind: 'archive' });
  assert.deepEqual(changeFolderFilters({ folderId: 'work', kind: 'archive', tag: 'x' }, { query: 'hello' }), { folderId: 'work', kind: 'archive', tag: 'x', query: 'hello' });
});
