import assert from 'node:assert/strict';
import React, { act } from 'react';
import test from 'node:test';
import type { ArchivePatch } from '../src/shared/archive';
import type { FolderContent, FolderMembershipChange, FolderTarget } from '../src/shared/task-folder';
import { setShellApi } from '../src/renderer/shell-api';
import { mountDom } from './ui/dom-harness';
import { archiveItems, button, copy, decision, folder, record, waitForInitial, workspace } from './ui/library-test-host';

const two = archiveItems(2);
function api(items: readonly FolderContent[], extra: Record<string, unknown> = {}) {
  setShellApi({ listFolders: async () => [folder], listArchiveTags: async () => [],
    searchFolderContents: async () => items, getArchive: async () => record, ...extra } as any);
}
async function selectPage(h: Awaited<ReturnType<typeof mountDom>>) {
  await waitForInitial(); assert.equal(h.document.querySelector('[data-action="library-select-page"]') !== null, true);
  await h.click(button(h.document, '[data-action="library-select-page"]'));
}
function downloads(h: Awaited<ReturnType<typeof mountDom>>) {
  const create = URL.createObjectURL, revoke = URL.revokeObjectURL;
  const click = h.window.HTMLAnchorElement.prototype.click;
  const blobs: Blob[] = []; let clicks = 0;
  URL.createObjectURL = blob => { blobs.push(blob as Blob); return `blob:fixture-${blobs.length}`; };
  URL.revokeObjectURL = () => {};
  h.window.HTMLAnchorElement.prototype.click = () => { clicks++; };
  return { blobs, clicked: () => clicks, close: () => { URL.createObjectURL = create; URL.revokeObjectURL = revoke; h.window.HTMLAnchorElement.prototype.click = click; } };
}

test('bulk favorite reports blocking synchronously, suppresses repeats and releases after settlement', async () => {
  const writes: string[] = [], blocking: boolean[] = []; let finish: (() => void) | undefined;
  api(two, { updateArchive: (id: string, patch: ArchivePatch) => {
    assert.deepEqual(patch, { favorite: true }); writes.push(id);
    return writes.length === 1 ? new Promise(resolve => { finish = () => resolve({ ...two[0].record, favorite: true }); })
      : Promise.resolve({ ...two[1].record, favorite: true });
  } });
  const h = await mountDom(workspace({ preferredId: null, onBlockingChange: value => blocking.push(value) }));
  try {
    await selectPage(h); assert.equal(blocking.includes(true), false, 'reading results does not block navigation');
    const favorite = button(h.document, '[data-action="library-bulk-favorite"]');
    await act(async () => { favorite.click(); favorite.click(); });
    assert.equal(writes.join(','), 'result-0000'); assert.equal(blocking.at(-1), true);
    assert.equal(h.document.querySelector<HTMLButtonElement>('.library-close')?.disabled, true);
    assert.equal(h.document.querySelector<HTMLInputElement>('[name="library-search"]')?.disabled, true);
    await act(async () => finish!());
    assert.equal(writes.join(','), 'result-0000,result-0001'); assert.equal(blocking.at(-1), false);
    assert.equal(h.document.querySelector<HTMLButtonElement>('.library-close')?.disabled, false);
    assert.equal(h.document.querySelector('.library-bulk-result')?.textContent?.includes('2 succeeded'), true);
  } finally { await h.close(); setShellApi(null); }
});

test('mixed kinds cannot be favorited and adding a folder preserves unrelated memberships', async () => {
  const members = new Map<string, string[]>([[`archive:${record.id}`, ['existing']], [`decision:${decision.id}`, ['other']]]);
  const changes: string[] = [];
  api([{ kind: 'archive', record }, { kind: 'decision', record: decision }], {
    patchFolderMemberships: async (target: FolderTarget, delta: readonly FolderMembershipChange[]) => {
      assert.deepEqual(delta, [{ folderId: folder.id, present: true }]);
      const key = `${target.kind}:${target.id}`; changes.push(key);
      members.set(key, [...members.get(key)!, folder.id]); return members.get(key)!;
    },
  });
  const h = await mountDom(workspace({ preferredId: null }));
  try {
    await selectPage(h);
    assert.equal(h.document.querySelector<HTMLButtonElement>('[data-action="library-bulk-favorite"]')?.disabled, true);
    assert.equal(h.document.querySelector('.library-bulk-actions')?.textContent?.includes('saved results only'), true);
    await h.click(button(h.document, '[data-action="library-bulk-add-folder"]'));
    await h.click(h.document.querySelector<HTMLInputElement>('[name="library-bulk-folder"]')!);
    await h.click(button(h.document, '[data-action="library-bulk-confirm-folders"]'));
    assert.equal(changes.sort().join(','), `archive:${record.id},decision:${decision.id}`);
    assert.equal(members.get(`archive:${record.id}`)?.join(','), 'existing,work');
    assert.equal(members.get(`decision:${decision.id}`)?.join(','), 'other,work');
  } finally { await h.close(); setShellApi(null); }
});

test('partial failure is reported and manual retry touches only failed targets', async () => {
  const writes: string[] = [], blocking: boolean[] = []; let failed = false;
  api(two, { updateArchive: async (id: string) => {
    writes.push(id); if (id === 'result-0000' && !failed) { failed = true; throw new Error('fixture_write_failure'); }
    return { ...record, id, favorite: true };
  } });
  const h = await mountDom(workspace({ preferredId: null, onBlockingChange: value => blocking.push(value) }));
  try {
    await selectPage(h); await h.click(button(h.document, '[data-action="library-bulk-favorite"]'));
    assert.equal(blocking.at(-1), false);
    assert.equal(h.document.querySelector('.library-bulk-result')?.textContent?.includes('1 succeeded'), true);
    assert.equal(h.document.querySelector('.library-bulk-result')?.textContent?.includes('1 failed'), true);
    await h.click(button(h.document, '[data-action="library-bulk-retry-failed"]'));
    assert.equal(writes.join(','), 'result-0000,result-0001,result-0000');
    assert.equal(h.document.querySelector('.library-bulk-result')?.textContent?.includes('2 succeeded'), true);
    assert.equal(h.document.querySelector<HTMLButtonElement>('.library-close')?.disabled, false);
  } finally { await h.close(); setShellApi(null); }
});

test('stop lets the current write settle and prevents all later snapshot targets', async () => {
  const writes: string[] = []; let finish: (() => void) | undefined;
  api(archiveItems(3), { updateArchive: (id: string) => { writes.push(id); return new Promise(resolve => { finish = () => resolve({ ...record, id, favorite: true }); }); } });
  const h = await mountDom(workspace({ preferredId: null }));
  try {
    await selectPage(h); await h.click(button(h.document, '[data-action="library-bulk-favorite"]'));
    await h.click(button(h.document, '[data-action="library-bulk-stop"]'));
    assert.equal(h.document.querySelector<HTMLButtonElement>('.library-close')?.disabled, true);
    await act(async () => finish!()); assert.equal(writes.join(','), 'result-0000');
    assert.equal(h.document.querySelector('.library-bulk-result')?.textContent?.includes('1 succeeded'), true);
    assert.equal(h.document.querySelector('.library-bulk-result')?.textContent?.includes('2 stopped'), true);
    assert.equal(h.document.querySelector<HTMLButtonElement>('.library-close')?.disabled, false);
  } finally { await h.close(); setShellApi(null); }
});

test('mixed export keeps canonical Markdown and never downloads a partial failed result', async () => {
  const calls: string[] = []; let fail = true;
  api([{ kind: 'archive', record }, { kind: 'decision', record: decision }], {
    archiveMarkdown: async (id: string, locale: string) => { calls.push(`archive:${id}:${locale}`); return '# Canonical archive\n\tExact source\n'; },
    decisionMarkdown: async (id: string, locale: string) => { calls.push(`decision:${id}:${locale}`); if (fail) throw new Error('fixture_export_failure'); return '# Canonical decision\nExact evidence\n'; },
  });
  const h = await mountDom(workspace({ preferredId: null })); const files = downloads(h);
  try {
    await selectPage(h); await h.click(button(h.document, '[data-action="library-bulk-export"]'));
    assert.equal(files.clicked(), 0); assert.equal(files.blobs.length, 0);
    assert.equal(h.document.querySelector('.library-bulk-result')?.textContent?.includes('1 failed'), true);
    assert.equal(h.document.querySelectorAll('.library-content-row input:checked').length, 2);
    fail = false; await h.click(button(h.document, '[data-action="library-bulk-retry-failed"]'));
    assert.equal(calls.join(','), `archive:${record.id}:en,decision:${decision.id}:en,decision:${decision.id}:en`);
    assert.equal(files.clicked(), 1); assert.equal(files.blobs.length, 1);
    const markdown = await files.blobs[0].text();
    assert.equal(markdown.includes('# Canonical archive\n\tExact source\n'), true);
    assert.equal(markdown.includes('# Canonical decision\nExact evidence\n'), true);
    assert.equal(markdown.indexOf('# Canonical archive') < markdown.indexOf('# Canonical decision'), true);
  } finally { files.close(); await h.close(); setShellApi(null); }
});

test('unmounting while export is pending cannot start another read or download late output', async () => {
  const calls: string[] = []; let finish: ((value: string) => void) | undefined;
  api(two, { archiveMarkdown: (id: string) => { calls.push(id); return new Promise<string>(resolve => { finish = resolve; }); } });
  const h = await mountDom(workspace({ preferredId: null })); const files = downloads(h);
  try {
    await selectPage(h); await h.click(button(h.document, '[data-action="library-bulk-export"]'));
    await h.render(<div>Another surface</div>); await act(async () => finish!('# Late source\n'));
    assert.equal(calls.join(','), 'result-0000'); assert.equal(files.clicked(), 0);
  } finally { files.close(); await h.close(); setShellApi(null); }
});
