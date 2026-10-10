import { withFolderPages } from './ui/library-page-api';
import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ArchiveMetadata } from '../src/renderer/archive-metadata';
import { FolderMembershipDialog } from '../src/renderer/folder-membership-dialog';
import { FolderWorkspace } from '../src/renderer/folder-workspace';
import { setShellApi } from '../src/renderer/shell-api';
import { getCopy } from '../src/shared/copy';
import type { ArchivePatch } from '../src/shared/archive';
import type { TaskFolder } from '../src/shared/task-folder';
import { archiveFixture } from './fixtures';
import { mountDom } from './ui/dom-harness';

const copy = getCopy('en');
const folder: TaskFolder = { id: 'new-folder', name: 'Research 😀', createdAt: 100, updatedAt: 100, deviceId: 'fixture', schema: 3 };
const fieldDescription = (doc: Document, field: Element) => field.getAttribute('aria-describedby')!.split(' ').map(id => doc.getElementById(id)!.textContent).join(' ');

test('metadata identifies oversized and excess tags before saving, and corrections retain notes', async () => {
  const submitted: ArchivePatch[] = [];
  const h = await mountDom(<ArchiveMetadata record={archiveFixture()} copy={copy} busy={false} onSave={async patch => { submitted.push(patch); return false; }} />);
  try {
    h.document.querySelector<HTMLDetailsElement>('details')!.open = true;
    const tags = h.document.querySelector<HTMLInputElement>('[name="archive-tags"]')!;
    const note = h.document.querySelector<HTMLTextAreaElement>('[name="archive-note"]')!;
    await h.input(tags, '😀'.repeat(33)); await h.input(note, 'Keep these notes.');
    await h.click(h.document.querySelector<HTMLButtonElement>('button[type="submit"]')!);
    assert.deepEqual(submitted, [], 'invalid tags never reach the save API');
    assert.equal(tags.getAttribute('aria-invalid'), 'true');
    assert.equal((h.document.activeElement) === (tags), true);
    assert.match(fieldDescription(h.document, tags), /Tag 1.*32 characters/);
    assert.match(h.document.querySelector('.archive-tag-counts')!.textContent!, /33 \/ 32/);
    await h.input(tags, Array(21).fill('same').join(', '));
    assert.match(fieldDescription(h.document, tags), /21.*20/);
    await h.input(tags, '😀'.repeat(32) + '， work');
    assert.notEqual(tags.getAttribute('aria-invalid'), 'true');
    await h.click(h.document.querySelector<HTMLButtonElement>('button[type="submit"]')!);
    assert.deepEqual(submitted, [{ tags: ['😀'.repeat(32), 'work'], note: 'Keep these notes.' }]);
    assert.equal(note.value, 'Keep these notes.'); assert.equal(tags.value, '😀'.repeat(32) + '， work');
    assert.match(h.document.querySelector('[role="status"]')!.textContent!, /edits are retained/);
  } finally { await h.close(); }
});

test('metadata suppresses repeated submit events while the same save is pending', async () => {
  let calls = 0, finish: ((saved: boolean) => void) | undefined;
  const h = await mountDom(<ArchiveMetadata record={archiveFixture()} copy={copy} busy={false} onSave={() => { calls++; return new Promise(resolve => { finish = resolve; }); }} />);
  try {
    await h.input(h.document.querySelector<HTMLInputElement>('[name="archive-tags"]')!, 'work');
    const form = h.document.querySelector('form')!;
    await act(async () => { form.dispatchEvent(new h.window.Event('submit', { bubbles: true, cancelable: true })); form.dispatchEvent(new h.window.Event('submit', { bubbles: true, cancelable: true })); });
    assert.equal(calls, 1);
    await act(async () => finish!(false));
    assert.equal(h.document.querySelector<HTMLInputElement>('[name="archive-tags"]')!.value, 'work');
  } finally { await h.close(); }
});

test('membership dialog displays complete object context for results and decision cards', () => {
  for (const kind of ['archive', 'decision'] as const) {
    const title = 'Full object title 😀 ' + 'detail '.repeat(35);
    const html = renderToStaticMarkup(<FolderMembershipDialog {...{ targetTitle: title }} copy={copy} target={{ kind, id: 'object' }} folders={[]} onCancel={() => {}} onSaved={() => {}} />);
    assert.ok(html.includes(title));
    assert.ok(html.includes(kind === 'archive' ? 'Saved result' : 'Decision card'));
    assert.match(html, /multiple folders/);
  }
});

test('membership creation retains failed input, prevents repeats, and waits for final association save', async () => {
  let creates = 0, patches = 0, saved = 0;
  let finish: ((value: TaskFolder) => void) | undefined;
  setShellApi({ folderMemberships: async () => ['existing'],
    createFolder: async () => { creates++; if (creates === 1) throw new Error('synthetic_failure'); return new Promise<TaskFolder>(resolve => { finish = resolve; }); },
    patchFolderMemberships: async (_target: unknown, changes: unknown) => { patches++; assert.deepEqual(changes, [{ folderId: 'new-folder', present: true }]); return ['existing', 'new-folder']; }
  } as any);
  const h = await mountDom(<FolderMembershipDialog {...{ targetTitle: 'Complete result title' }} copy={copy} target={{ kind: 'archive', id: 'result' }}
    folders={[{ ...folder, id: 'existing', name: 'Existing' }]} onCancel={() => {}} onSaved={() => { saved++; }} />);
  try {
    const newButton = [...h.document.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === copy.folderNew);
    assert.ok(newButton, 'folder creation is available within the membership dialog');
    await h.click(newButton);
    const name = h.document.querySelector<HTMLInputElement>('[name="folder-membership-name"]')!;
    await h.input(name, 'Research 😀');
    const create = h.document.querySelector<HTMLButtonElement>('[data-action="create-folder"]')!;
    await h.click(create);
    assert.equal(name.value, 'Research 😀');
    assert.match(h.document.querySelector('[role="status"]')!.textContent!, /edits are retained/);
    await act(async () => { create.click(); create.click(); });
    assert.equal(creates, 2, 'same-tick duplicate does not create a third folder');
    await act(async () => finish!(folder));
    const checks = [...h.document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
    assert.deepEqual(checks.map(input => input.checked), [true, true]);
    assert.ok(h.document.activeElement === checks[1], 'creation returns keyboard focus to the selected new folder');
    assert.equal(patches, 0, 'creating a folder does not save associations');
    await h.click(h.document.querySelector<HTMLButtonElement>('[data-action="save-memberships"]')!);
    assert.equal(saved, 1); assert.equal(patches, 1);
  } finally { setShellApi(null); await h.close(); }
});

test('membership save suppresses repeated confirmation while preserving selected associations', async () => {
  let writes = 0, finish: (() => void) | undefined;
  setShellApi({ folderMemberships: async () => [], patchFolderMemberships: () => {
    writes++; return new Promise(resolve => { finish = () => resolve(['new-folder']); });
  } } as any);
  const h = await mountDom(<FolderMembershipDialog copy={copy} targetTitle="Result title" target={{ kind: 'archive', id: 'result' }} folders={[folder]} onCancel={() => {}} onSaved={() => {}} />);
  try {
    await h.click(h.document.querySelector<HTMLInputElement>('input[type="checkbox"]')!);
    const save = h.document.querySelector<HTMLButtonElement>('[data-action="save-memberships"]')!;
    await act(async () => { save.click(); save.click(); });
    assert.equal(writes, 1);
    await act(async () => finish!());
    assert.equal(h.document.querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked, true);
  } finally { setShellApi(null); await h.close(); }
});

test('membership folder names use the existing 80-codepoint bound and expose a recoverable field error', async () => {
  let createdName = '';
  setShellApi({ folderMemberships: async () => [], createFolder: async (name: string) => { createdName = name; return { ...folder, name }; } } as any);
  const h = await mountDom(<FolderMembershipDialog {...{ targetTitle: 'Decision title' }} copy={copy} target={{ kind: 'decision', id: 'card' }} folders={[]} onCancel={() => {}} onSaved={() => {}} />);
  try {
    const newButton = [...h.document.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === copy.folderNew);
    assert.ok(newButton, 'empty membership choices offer folder creation'); await h.click(newButton);
    const name = h.document.querySelector<HTMLInputElement>('[name="folder-membership-name"]')!;
    await h.input(name, '😀'.repeat(81));
    await h.click(h.document.querySelector<HTMLButtonElement>('[data-action="create-folder"]')!);
    assert.equal(createdName, ''); assert.equal(name.getAttribute('aria-invalid'), 'true');
    assert.match(fieldDescription(h.document, name), /81 \/ 80.*1–80/);
    await h.input(name, ' ' + '😀'.repeat(80) + ' ');
    assert.notEqual(name.getAttribute('aria-invalid'), 'true');
    await h.click(h.document.querySelector<HTMLButtonElement>('[data-action="create-folder"]')!);
    assert.equal(createdName, '😀'.repeat(80));
    assert.equal(h.document.querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked, true);
  } finally { setShellApi(null); await h.close(); }
});

test('a created folder remains visible in the library when association editing is canceled', async () => {
  const record = archiveFixture();
  const folders: TaskFolder[] = [];
  setShellApi(withFolderPages({ listFolders: async () => [...folders], searchFolderContents: async () => [{ kind: 'archive', record }],
    listArchiveTags: async () => [], getArchive: async () => record, folderMemberships: async () => [],
    createFolder: async () => { folders.push(folder); return folder; }
  }) as any);
  const h = await mountDom(<FolderWorkspace copy={copy} locale="en" preferredId={record.id} onClose={() => {}}
    onCapture={async () => record} sites={[]} synthesisSites={[]} defaultTier={null} pendingSynthesis={null} synthesisCandidate={null}
    onSendSynthesis={async () => {}} onCollectSynthesis={async () => {}} onSaveSynthesis={async () => record}
    renderArchive={(_record, _changed, _decision, _busy, _saved, organize) => <button id="test-organize" onClick={organize}>Organize</button>} />);
  try {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); });
    await h.click(h.document.querySelector<HTMLButtonElement>('#test-organize')!);
    const newButton = [...h.document.querySelectorAll<HTMLButtonElement>('.folder-modal button')].find(button => button.textContent === copy.folderNew)!;
    await h.click(newButton); await h.input(h.document.querySelector<HTMLInputElement>('[name="folder-membership-name"]')!, 'Research 😀');
    await h.click(h.document.querySelector<HTMLButtonElement>('[data-action="create-folder"]')!);
    await h.click(h.document.querySelector<HTMLButtonElement>('.folder-modal header button')!);
    assert.ok([...h.document.querySelectorAll('.folder-sidebar nav button')].some(button => button.querySelector('.library-folder-name')?.textContent === 'Research 😀'),
      'creating a folder updates the library even when no association is saved');
  } finally { setShellApi(null); await h.close(); }
});

test('an older library refresh cannot remove a folder created during association editing', async () => {
  const record = archiveFixture();
  const folders: TaskFolder[] = [];
  const finishContents: (() => void)[] = [];
  setShellApi(withFolderPages({ listFolders: async () => [...folders], searchFolderContents: () => new Promise(resolve => {
    finishContents.push(() => resolve([{ kind: 'archive', record }]));
  }), listArchiveTags: async () => [], getArchive: async () => record, folderMemberships: async () => [],
  createFolder: async () => { folders.push(folder); return folder; }
  }) as any);
  const h = await mountDom(<FolderWorkspace copy={copy} locale="en" preferredId={record.id} onClose={() => {}}
    onCapture={async () => record} sites={[]} synthesisSites={[]} defaultTier={null} pendingSynthesis={null} synthesisCandidate={null}
    onSendSynthesis={async () => {}} onCollectSynthesis={async () => {}} onSaveSynthesis={async () => record}
    renderArchive={(_record, _changed, _decision, _busy, _saved, organize) => <button id="test-organize" onClick={organize}>Organize</button>} />);
  try {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); });
    assert.ok(finishContents.length > 0, 'a refresh has captured the earlier empty folder list');
    await h.click(h.document.querySelector<HTMLButtonElement>('#test-organize')!);
    await h.click([...h.document.querySelectorAll<HTMLButtonElement>('.folder-modal button')].find(button => button.textContent === copy.folderNew)!);
    await h.input(h.document.querySelector<HTMLInputElement>('[name="folder-membership-name"]')!, 'Research 😀');
    await h.click(h.document.querySelector<HTMLButtonElement>('[data-action="create-folder"]')!);
    await h.click(h.document.querySelector<HTMLButtonElement>('.folder-modal header button')!);
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); });
    await act(async () => { finishContents.splice(0).forEach(finish => finish()); });
    assert.ok([...h.document.querySelectorAll('.folder-sidebar nav button')].some(button => button.querySelector('.library-folder-name')?.textContent === 'Research 😀'),
      'completing an earlier empty snapshot retains the newly created folder');
  } finally { setShellApi(null); await h.close(); }
});
