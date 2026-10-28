import { withFolderPages } from './ui/library-page-api';
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
  setShellApi(withFolderPages({ listFolders: async () => [folder], listArchiveTags: async () => [],
    searchFolderContents: async () => items, getArchive: async () => record, ...extra }) as any);
}
async function selectPage(h: Awaited<ReturnType<typeof mountDom>>) {
  await waitForInitial(); assert.equal(h.document.querySelector('[data-action="library-select-page"]') !== null, true);
  await h.click(button(h.document, '[data-action="library-select-page"]'));
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

test('mixed Markdown export keeps selection on failure and refreshes before saving one file', async () => {
  let fail = true, saves = 0;
  api([{ kind: 'archive', record }, { kind: 'decision', record: decision }], {
    previewMarkdown: async ({ targets }: any) => { if (fail) throw new Error('markdown_not_found');
      return targets.map((target: any) => ({ target, revision: 'r1', title: target.kind, createdAt: 1, updatedAt: 1,
        entries: [{ id: 'one', site: target.kind, label: target.kind, kind: target.kind === 'decision' ? 'decision' : 'answer', available: true, capturedAt: 1, state: 'complete', truncated: false }] })); },
    exportMarkdown: async () => { saves++; return { status: 'saved' }; }
  });
  const h = await mountDom(workspace({ preferredId: null }));
  const byLabel = (label: string) => [...h.document.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent === label)!;
  try {
    await selectPage(h); await h.click(button(h.document, '[data-action="library-bulk-export"]'));
    assert.equal(saves, 0); assert.equal(h.document.querySelector('[role=dialog] [role=alert]')?.textContent, copy.markdownNotFound);
    assert.equal(h.document.querySelectorAll('.library-content-row input:checked').length, 2);
    fail = false; await h.click(byLabel(copy.markdownRefresh));
    await h.click(byLabel(copy.markdownAll)); await h.click(byLabel(copy.markdownSaveOne));
    assert.equal(saves, 1); assert.equal(h.document.querySelector('[role=dialog]') === null, true);
    assert.equal(h.document.querySelectorAll('.library-content-row input:checked').length, 2);
  } finally { await h.close(); setShellApi(null); }
});

test('unmounting while Markdown preview is pending cannot save a late result', async () => {
  let calls = 0, saves = 0, finish!: (value: unknown[]) => void;
  api(two, { previewMarkdown: () => { calls++; return new Promise(resolve => { finish = resolve; }); },
    exportMarkdown: async () => { saves++; return { status: 'saved' }; } });
  const h = await mountDom(workspace({ preferredId: null }));
  try {
    await selectPage(h); await h.click(button(h.document, '[data-action="library-bulk-export"]'));
    await h.render(<div>Another surface</div>); await act(async () => finish([]));
    assert.equal(calls, 1); assert.equal(saves, 0);
  } finally { await h.close(); setShellApi(null); }
});
