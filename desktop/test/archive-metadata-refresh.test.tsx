import assert from 'node:assert/strict';
import test from 'node:test';
import { act } from 'react';
import { setShellApi } from '../src/renderer/shell-api';
import { withFolderPages } from './ui/library-page-api';
import { record, workspace, mountLibrary, sessionFixture, waitForInitial, waitForQuery } from './ui/library-test-host';
import { ArchiveMetadata } from '../src/renderer/archive-metadata';
import { mountDom } from './ui/dom-harness';
import { copy } from './ui/library-test-host';
import { updateArchiveRecord, type ArchiveRecord } from '../src/shared/archive';

test('matching list refresh preserves metadata edited while the request was pending', async () => {
  let current = { ...record, note: 'Stored note before sync' };
  let finish!: (value: any[]) => void;
  setShellApi(withFolderPages({
    listFolders: async () => [], listArchiveTags: async () => [],
    getArchive: async () => current,
    searchFolderContents: (filter: any) => filter.query
      ? new Promise<any[]>(resolve => { finish = resolve; })
      : Promise.resolve([{ kind: 'archive', record: current }]),
  }) as any);
  const session = sessionFixture({ selectedKey: `archive:${record.id}`, pane: 'detail' });
  const h = await mountLibrary(workspace({ preferredId: null, session }));
  try {
    await waitForInitial();
    await h.input(h.document.querySelector<HTMLInputElement>('[name="library-search"]')!, 'matching');
    await waitForQuery();
    h.document.querySelector<HTMLDetailsElement>('.archive-metadata')!.open = true;
    await h.input(h.document.querySelector<HTMLTextAreaElement>('[name="archive-note"]')!, 'Unsaved local note');
    current = { ...current, note: 'New note from another device', updatedAt: current.updatedAt + 1 };
    await act(async () => finish([{ kind: 'archive', record: current }]));
    assert.equal(h.document.querySelector<HTMLTextAreaElement>('[name="archive-note"]')?.value, 'Unsaved local note',
      'refresh must not overwrite local edits without confirmation');
  } finally { await h.close(); setShellApi(null); }
});

test('same-record updates preserve dirty tags while refreshing clean notes, and cancel adopts the latest record', async () => {
  let current = { ...record, note: 'Original note', tags: ['original'] };
  const element = () => <ArchiveMetadata record={current} copy={copy} busy={false} onSave={async () => true} />;
  const h = await mountDom(element());
  try {
    await h.input(h.document.querySelector<HTMLInputElement>('[name=archive-tags]')!, 'unsaved tags');
    current = { ...current, tags: ['remote'], note: 'Remote note' }; await h.render(element());
    assert.equal(h.document.querySelector<HTMLInputElement>('[name=archive-tags]')!.value, 'unsaved tags');
    assert.equal(h.document.querySelector<HTMLTextAreaElement>('[name=archive-note]')!.value, 'Remote note');
    await h.click([...h.document.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent === copy.cancel)!);
    assert.equal(h.document.querySelector<HTMLInputElement>('[name=archive-tags]')!.value, 'remote');
    await h.input(h.document.querySelector<HTMLTextAreaElement>('[name=archive-note]')!, 'local note');
    current = { ...current, id: 'another-record', note: 'Other note', tags: ['other'] }; await h.render(element());
    assert.equal(h.document.querySelector<HTMLTextAreaElement>('[name=archive-note]')!.value, 'Other note');
  } finally { await h.close(); }
});

test('a successful metadata save normalizes tags and clears the unsaved marker', async () => {
  let current: ArchiveRecord = { ...record, note: '', tags: [] };
  const element = () => <ArchiveMetadata record={current} copy={copy} busy={false} onSave={async patch => {
    current = updateArchiveRecord(current, patch, { now: current.updatedAt + 1, deviceId: current.deviceId });
    await h.render(element()); return true;
  }} />;
  const h = await mountDom(element());
  try {
    await h.input(h.document.querySelector<HTMLInputElement>('[name=archive-tags]')!, ' first， second, first ');
    await h.input(h.document.querySelector<HTMLTextAreaElement>('[name=archive-note]')!, 'Saved note');
    await h.click(h.document.querySelector<HTMLButtonElement>('button[type=submit]')!);
    assert.equal(h.document.querySelector<HTMLInputElement>('[name=archive-tags]')!.value, 'first, second');
    assert.equal(h.document.querySelector('summary small') === null, true);
  } finally { await h.close(); }
});
