import assert from 'node:assert/strict';
import React from 'react';
import test from 'node:test';
import { FolderSidebar } from '../src/renderer/folder-sidebar';
import { folder, copy } from './ui/library-test-host';
import { mountDom } from './ui/dom-harness';

test('folder counts come from the global summary and missing counts remain unknown', async () => {
  const h = await mountDom(<FolderSidebar copy={copy} folders={[{ ...folder, contentCount: 151 }, { ...folder, id: 'unknown', name: 'Uncounted' }] as any}
    selected="" onSelect={() => {}} onChanged={() => {}} />);
  try {
    assert.equal(h.document.querySelectorAll('.library-folder-count').length, 2);
    const counts = [...h.document.querySelectorAll('.library-folder-count')].map(node => node.textContent);
    assert.equal(counts[0], '151'); assert.equal(counts[1], '—');
    assert.equal(h.document.querySelectorAll('.library-folder-count')[1]?.getAttribute('title')?.includes('unavailable'), true);
  } finally { await h.close(); }
});

test('folder name search limits navigation without changing the selected folder or content filters', async () => {
  const selected: string[] = [];
  const h = await mountDom(<FolderSidebar copy={copy} folders={[folder, { ...folder, id: 'other', name: 'Other folder' }]} selected="other"
    onSelect={id => selected.push(id)} onChanged={() => {}} />);
  try {
    assert.equal(h.document.querySelector('[name="library-folder-search"]') !== null, true);
    await h.input(h.document.querySelector<HTMLInputElement>('[name="library-folder-search"]')!, 'Research');
    assert.equal(h.document.querySelectorAll('.folder-sidebar nav button').length, 3, 'all/unfiled remain plus one matching folder');
    assert.equal(selected.length, 0);
    assert.equal(h.document.querySelector('.folder-manage') !== null, true, 'the selected hidden-name folder remains selected');
  } finally { await h.close(); }
});

test('parent blocking disables folder writes and navigation while ordinary browsing stays enabled', async () => {
  const h = await mountDom(<FolderSidebar copy={copy} folders={[folder]} selected={folder.id} onSelect={() => {}} onChanged={() => {}} {...{ disabled: true }} />);
  try { assert.equal(h.document.querySelectorAll('.folder-sidebar button:not(:disabled)').length, 0); }
  finally { await h.close(); }
});
