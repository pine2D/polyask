import assert from 'node:assert/strict';
import test from 'node:test';
import { act } from 'react';
import { comparisonMount, comparisonCopy as copy, comparisonRecord, comparisonWait } from './ui/comparison-dom';
import { mountDom } from './ui/dom-harness';
import { setShellApi } from '../src/renderer/shell-api';
import { focusableControls } from '../src/renderer/focusable-controls';
import type { TaskFolder } from '../src/shared/task-folder';

const folders: TaskFolder[] = ['research', 'review'].map(id => ({ id, name: id, schema: 3, deviceId: 'fixture', createdAt: 1, updatedAt: 1 }));

test('hidden organization preserves dirty notes, refreshes clean tags and stays outside keyboard navigation', async () => {
  const { ArchiveOrganizationPanel } = await import('../src/renderer/archive-organization-panel');
  let record = { ...comparisonRecord, tags: ['before'], note: 'Before sync' }, open = true, dirty = false;
  setShellApi({ listFolders: async () => folders, folderMemberships: async () => ['research'] } as any);
  const render = () => <ArchiveOrganizationPanel record={record} copy={copy} busy={false} open={open}
    onOpenChange={value => { open = value; }} onDirtyChange={value => { dirty = value; }} onSave={async () => false} />;
  const h = await mountDom(render());
  try {
    const note = h.document.querySelector<HTMLTextAreaElement>('[name=archive-note]')!;
    await h.input(note, 'Local draft');
    open = false; await h.render(render());
    record = { ...record, note: 'Remote note', tags: ['remote'], updatedAt: 300 }; await h.render(render());
    const panel = h.document.querySelector<HTMLElement>('.archive-organization-panel')!;
    assert.equal(panel.hidden, true); assert.equal(panel.hasAttribute('inert'), true);
    assert.equal(focusableControls(panel).length, 0);
    open = true; await h.render(render());
    assert.equal(h.document.querySelector('[name=archive-note]') === note, true);
    assert.equal(note.value, 'Local draft');
    assert.equal(h.document.querySelector<HTMLInputElement>('[name=archive-tags]')!.value, 'remote');
    assert.equal(dirty, true);
    assert.equal(h.document.querySelectorAll('[name=archive-note]').length, 1);
  } finally { await h.close(); setShellApi(null); }
});

test('organization reads ignore a previous record and expose retry on failed membership reads', async () => {
  const { ArchiveOrganizationPanel } = await import('../src/renderer/archive-organization-panel');
  let record = comparisonRecord, finish!: (ids: string[]) => void, fail = true;
  setShellApi({ listFolders: async () => folders, folderMemberships: async ({ id }: { id: string }) => {
    if (id === comparisonRecord.id) return new Promise<string[]>(resolve => { finish = resolve; });
    if (fail) throw new Error('synthetic_read_failure'); return ['review'];
  } } as any);
  const render = () => <ArchiveOrganizationPanel record={record} copy={copy} busy={false} open onOpenChange={() => {}}
    onDirtyChange={() => {}} onSave={async () => true} />;
  const h = await mountDom(render());
  try {
    record = { ...record, id: 'other' }; await h.render(render());
    assert.equal(h.document.querySelector('.archive-organization-folders')!.textContent!.includes(copy.folderLoadFailed), true);
    await act(async () => finish(['research']));
    assert.equal(h.document.querySelector('.archive-organization-folders')!.textContent!.includes('research'), false);
    fail = false;
    await h.click(h.document.querySelector<HTMLButtonElement>('.archive-organization-retry')!);
    assert.equal(h.document.querySelector('.archive-organization-folders')!.textContent!.includes('review'), true);
  } finally { await h.close(); setShellApi(null); }
});

test('folder memberships save independently without discarding dirty metadata or remounting its fields', async () => {
  let membership: string[] = [], saves = 0;
  const h = await comparisonMount({ startInRead: true, api: {
    listFolders: async () => folders, folderMemberships: async () => membership,
    patchFolderMemberships: async (_target: unknown, changes: { folderId: string; present: boolean }[]) => {
      membership = changes.filter(item => item.present).map(item => item.folderId); return membership;
    }, updateArchive: async () => { saves++; throw new Error('synthetic_metadata_failure'); }
  } });
  try {
    await h.click(h.document.querySelector<HTMLButtonElement>('.library-organize')!);
    assert.equal(h.document.querySelector('.archive-organization-panel:not([hidden])') !== null, true);
    const note = h.document.querySelector<HTMLTextAreaElement>('[name=archive-note]')!;
    await h.input(note, 'Keep draft across folder save');
    const membershipButton = h.document.querySelector<HTMLButtonElement>('.archive-organization-membership')!;
    membershipButton.focus(); await h.click(membershipButton);
    assert.equal(h.document.querySelectorAll('.confirm-dialog').length, 1, 'only the membership dialog opens');
    for (const field of h.document.querySelectorAll<HTMLInputElement>('.folder-checkboxes input')) await h.click(field);
    await h.click(h.document.querySelector<HTMLButtonElement>('[data-action=save-memberships]')!);
    await comparisonWait(() => !h.document.querySelector('.folder-modal'));
    assert.deepEqual(membership, ['research', 'review']);
    assert.equal(h.document.querySelector('[name=archive-note]') === note, true);
    assert.equal(note.value, 'Keep draft across folder save');
    assert.equal(h.document.querySelector('.library-organize')!.getAttribute('data-dirty'), 'true');
    assert.equal(h.document.querySelector('.archive-organization-folders')!.textContent!.includes('review'), true);
    const save = h.document.querySelector<HTMLButtonElement>('.archive-metadata button[type=submit]')!;
    save.focus(); await h.click(save);
    assert.equal(saves, 1); assert.equal(note.value, 'Keep draft across folder save');
    assert.equal(h.document.querySelector('.archive-metadata [role=status]')!.textContent, copy.archiveMetadataSaveFailed);
    assert.equal(h.document.activeElement === save, true);
  } finally { await h.close(); }
});

test('a hidden dirty organizer guards record navigation once and returns to its edited field on cancel', async () => {
  const h = await comparisonMount({ startInRead: true });
  try {
    const organize = h.document.querySelector<HTMLButtonElement>('.library-organize')!;
    organize.focus(); await h.click(organize);
    assert.equal(h.document.querySelector('.archive-organization-panel:not([hidden])') !== null, true);
    const note = h.document.querySelector<HTMLTextAreaElement>('[name=archive-note]')!;
    note.focus(); await h.input(note, 'Do not discard me');
    await h.click(h.document.querySelector<HTMLButtonElement>('.archive-organization-close')!);
    assert.equal(h.document.activeElement === organize, true, JSON.stringify({ active: h.document.activeElement?.outerHTML.slice(0, 250), connected: organize.isConnected, same: h.document.querySelector('.library-organize') === organize }));
    const other = h.document.querySelector<HTMLButtonElement>('.archive-list button:not([aria-current=true])')!;
    await h.click(other); await comparisonWait(() => h.document.querySelector('.confirm-dialog'));
    assert.equal(h.document.querySelectorAll('.confirm-dialog').length, 1);
    await h.click(h.document.querySelector<HTMLButtonElement>('.confirm-actions button:not(.primary)')!);
    assert.equal(note.value, 'Do not discard me');
    assert.equal(h.document.querySelector('.archive-organization-panel')!.hasAttribute('hidden'), false);
    assert.equal(h.document.activeElement === note, true);
    await h.click(h.document.querySelector<HTMLButtonElement>('.archive-organization-close')!);
    assert.equal(h.document.activeElement === organize, true, 'closing after cancelled navigation still returns to Organize');
    await h.click(organize);
    await h.click(other); await comparisonWait(() => h.document.querySelector('.confirm-dialog'));
    await h.click(h.document.querySelector<HTMLButtonElement>('.confirm-actions .primary')!);
    await comparisonWait(() => h.document.querySelector('.archive-detail h1')?.textContent === 'Other saved result');
    assert.equal(h.document.querySelector('.confirm-dialog') === null, true);
    assert.equal(h.document.querySelector<HTMLTextAreaElement>('[name=archive-note]')!.value, comparisonRecord.note);
    assert.equal(h.document.querySelector('.archive-organization-panel')!.hasAttribute('hidden'), true);
  } finally { await h.close(); }
});

test('a late failed save cannot focus a field inside a hidden organizer', async () => {
  const { ArchiveOrganizationPanel } = await import('../src/renderer/archive-organization-panel');
  let open = true, finish!: (value: boolean) => void;
  setShellApi({ listFolders: async () => [], folderMemberships: async () => [] } as any);
  const render = () => <ArchiveOrganizationPanel record={comparisonRecord} copy={copy} busy={false} open={open}
    onOpenChange={() => {}} onDirtyChange={() => {}} onSave={() => new Promise(resolve => { finish = resolve; })} />;
  const h = await mountDom(render());
  try {
    await h.input(h.document.querySelector<HTMLTextAreaElement>('[name=archive-note]')!, 'Keep hidden failure');
    const save = h.document.querySelector<HTMLButtonElement>('button[type=submit]')!;
    save.focus(); await h.click(save); save.blur();
    open = false; await h.render(render());
    // Chromium drops focus when the focused control becomes hidden; jsdom needs that transition explicitly.
    h.document.body.tabIndex = -1; h.document.body.focus();
    assert.equal(h.document.activeElement === h.document.body, true);
    await act(async () => finish(false));
    assert.equal(h.document.activeElement?.closest('.archive-organization-panel') === null, true);
    open = true; await h.render(render());
    assert.equal(h.document.querySelector<HTMLTextAreaElement>('[name=archive-note]')!.value, 'Keep hidden failure');
    assert.equal(h.document.querySelector('.archive-metadata [role=status]')!.textContent, copy.archiveMetadataSaveFailed);
  } finally { await h.close(); setShellApi(null); }
});

test('organization Escape respects composition and returns to the current toolbar after focus mode changes', async () => {
  const h = await comparisonMount({ startInRead: true });
  try {
    const organize = h.document.querySelector<HTMLButtonElement>('.library-organize')!;
    organize.focus(); await h.click(organize);
    const panel = h.document.querySelector<HTMLElement>('.archive-organization-panel')!;
    await act(async () => panel.dispatchEvent(new h.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, isComposing: true })));
    assert.equal(panel.hidden, false);
    await h.click(h.document.querySelector<HTMLButtonElement>('.library-focus')!);
    await act(async () => panel.dispatchEvent(new h.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    assert.equal(panel.hidden, true);
    assert.equal(h.document.activeElement === h.document.querySelector('.folder-toolbar .library-organize'), true);
  } finally { await h.close(); }
});

test('mounting an unopened organizer leaves navigation focus alone', async () => {
  const { ArchiveOrganizationPanel } = await import('../src/renderer/archive-organization-panel');
  const h = await mountDom(<section className="folder-workspace"><button className="library-organize">Organize</button>
    <ArchiveOrganizationPanel record={comparisonRecord} copy={copy} busy={false} open={false}
      onOpenChange={() => {}} onDirtyChange={() => {}} onSave={async () => true} /></section>);
  try { assert.equal(h.document.activeElement === h.document.body, true); }
  finally { await h.close(); }
});
