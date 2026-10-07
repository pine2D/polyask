import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { BackupComparison, eligibleBackupSelection } from '../src/renderer/backup-comparison';
import { BackupWorkspace } from '../src/renderer/backup-workspace';
import { getCopy } from '../src/shared/copy';
import type { BackupPreview, BackupPreviewItem } from '../src/shared/backup';
import { mountDom } from './ui/dom-harness';
import { setShellApi } from '../src/renderer/shell-api';
import { BackupDependencies } from '../src/renderer/backup-dependencies';
import { backupDependencyPlan, visibleBackupSelection } from '../src/renderer/backup-selection';

export const previewItem = (key: string, kind: BackupPreviewItem['kind'], status: BackupPreviewItem['status'], extra: Partial<BackupPreviewItem> = {}): BackupPreviewItem =>
  ({ key, id: key.slice(key.indexOf(':') + 1), kind, status, title: key, local: status === 'new' ? null : { task: 'Local' }, backup: { task: 'Backup' }, ...extra });
const countFixture = (preview: BackupPreview) => async (_token: string, keys: string[]) => {
  const eligible = [...eligibleBackupSelection(preview.items, new Set(keys))];
  return { imported: eligible.length, skipped: preview.items.length - eligible.length, keys: eligible };
};

for (const [locale, yes, status] of [['en', 'Yes', 'Final'], ['zh-CN', '是', '已定稿'], ['zh-TW', '是', '已定稿']]) {
  test(`backup comparison explains booleans, timestamps, fixed enums and known sites in ${locale}`, () => {
    const item = previewItem('archive:a', 'archive', 'new', { backup: { favorite: true, status: 'final', host: 'chatgpt.com',
      source: { capturedAt: 1767225600000, kind: 'page', truncated: false }, futureValue: 'future-value' } });
    const html = renderToStaticMarkup(<BackupComparison locale={locale} copy={getCopy(locale)} item={item} selected onSelect={() => {}} />);
    assert.ok(html.includes(yes), 'boolean is rendered in the user language');
    assert.ok(html.includes(status), 'stored status is rendered in the user language');
    assert.match(html, /ChatGPT/);
    assert.doesNotMatch(html, />true<|>false<|>1767225600000<|>final<|>page</);
    assert.ok(html.includes('future-value'), 'unknown fields and values remain readable');
  });
}

test('backup conflicts highlight changed fields while complete and raw versions remain available', async () => {
  const item = previewItem('archive:a', 'archive', 'conflict', { local: { task: 'Unchanged title', favorite: false, note: 'Local note' },
    backup: { task: 'Unchanged title', favorite: true, note: 'Backup note', unknownField: 'Keep unknown data' } });
  const h = await mountDom(<BackupComparison locale="en" copy={getCopy('en')} item={item} selected={false} onSelect={() => {}} />);
  try {
    assert.ok(!h.document.querySelector('.backup-versions')!.textContent?.includes('Unchanged title'), 'unchanged field does not crowd the default comparison');
    assert.ok(h.document.querySelector('[data-changed="true"]'), 'changed field is visibly identified');
    assert.ok(h.document.querySelector('details')?.textContent?.includes('Unchanged title'), 'complete versions can be expanded');
    assert.ok([...h.document.querySelectorAll('details')].some(node => node.textContent?.includes('"favorite"')), 'original scalar values remain inspectable');
  } finally { await h.close(); }
});

test('clearing visible choices preserves hidden selections and dependency planning traverses safely', () => {
  const child = previewItem('folderMembership:link', 'folderMembership', 'conflict', { requires: ['folder:f'] });
  const folder = previewItem('folder:f', 'folder', 'conflict', { requires: ['archive:missing'] });
  const deleted = previewItem('archive:deleted', 'archive', 'deleted');
  const selected = new Set([child.key, deleted.key]);
  assert.deepEqual([...visibleBackupSelection([child], selected, false)], [deleted.key]);
  const plan = backupDependencyPlan([child, folder, deleted], selected, child);
  assert.deepEqual([...plan.add], [folder.key]);
  assert.deepEqual([...plan.missing], ['archive:missing']);
  assert.deepEqual([...eligibleBackupSelection([child, folder], new Set([child.key, folder.key]))], []);
});

test('a selected source that cannot restore is still explained as unavailable', () => {
  const source = previewItem('archive:a', 'archive', 'deleted', { blocked: true });
  const item = previewItem('decision:d', 'decision', 'new', { source: { key: source.key, title: 'Saved original', available: false } });
  const html = renderToStaticMarkup(<BackupDependencies item={item} items={[item, source]} selected={new Set([item.key, source.key])}
    copy={getCopy('en')} onAdd={() => {}} onLocate={() => {}} />);
  assert.ok(html.includes('Saved excerpts remain'), 'missing-source allowance is explained even if an unavailable source was selected');
  assert.ok(!html.includes('Source is selected for import'));
  assert.deepEqual([...eligibleBackupSelection([item, source], new Set([item.key, source.key]))], [item.key]);
});

test('optional missing decision sources do not enter the required-object repair count', () => {
  const item = previewItem('decision:d', 'decision', 'new', { source: { key: 'archive:missing', title: 'Original answer', available: false } });
  const plan = backupDependencyPlan([item], new Set([item.key]), item);
  assert.equal(plan.missing.size, 0, 'advisory source absence is not a hard restore requirement');
});

test('a reused folder dependency explains the available mapping instead of waiting for a new write', () => {
  const folder = previewItem('folder:f', 'folder', 'deleted', { note: 'folder_reused' });
  const item = previewItem('folderMembership:link', 'folderMembership', 'new', { requires: [folder.key] });
  const html = renderToStaticMarkup(<BackupDependencies item={item} items={[item, folder]} selected={new Set([item.key, folder.key])}
    copy={getCopy('en')} onAdd={() => {}} onLocate={() => {}} />);
  assert.ok(html.includes('Use the previously restored folder'));
  assert.ok(!html.includes('Selected · required items missing'));
});

test('a reused question dependency explains its available identity without counting another parent write', () => {
  const parent = previewItem('question:q', 'question', 'deleted', { note: 'question_new_identity', reusesIdentity: true });
  const item = previewItem('questionAnswer:a', 'questionAnswer', 'new', { requires: [parent.key] });
  const selected = new Set([parent.key, item.key]);
  assert.deepEqual([...eligibleBackupSelection([item, parent], selected)], [item.key]);
  const html = renderToStaticMarkup(<BackupDependencies item={item} items={[item, parent]} selected={selected}
    copy={getCopy('en')} onAdd={() => {}} onLocate={() => {}} />);
  assert.ok(html.includes('Use the previously restored question'));
  assert.ok(!html.includes('Selected · required items missing'));
});

test('backup import counts exclude identical records and records whose selected dependency is blocked', () => {
  const items = [previewItem('archive:same', 'archive', 'same'), previewItem('folder:blocked', 'folder', 'deleted', { blocked: true }),
    previewItem('folderMembership:link', 'folderMembership', 'new', { requires: ['folder:blocked'] })];
  assert.deepEqual([...eligibleBackupSelection(items, new Set(items.map(item => item.key)))], []);
});

test('backup ignores late selection counts and keeps final confirmation disabled while recalculating', async () => {
  const preview: BackupPreview = { token: 'late-counts', exportedAt: 1000, items: [previewItem('archive:a', 'archive', 'conflict')] };
  const pending: Array<{ keys: string[]; resolve: (value: any) => void }> = [];
  setShellApi({ previewBackupSelection: async (_token: string, keys: string[]) => new Promise(resolve => pending.push({ keys, resolve })) } as any);
  const h = await mountDom(<BackupWorkspace preview={preview} copy={getCopy('en')} locale="en" onClose={() => {}} onApplied={() => {}} />);
  try {
    const next = () => h.document.querySelector<HTMLButtonElement>('.backup-footer button')!;
    assert.equal(next().disabled, true, 'initial authoritative count is pending');
    await h.click([...h.document.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent === 'Use backup for 1 visible items')!);
    assert.equal(pending.length, 2);
    assert.equal(next().disabled, true);
    await act(async () => pending[1].resolve({ imported: 1, skipped: 0, keys: ['archive:a'] }));
    assert.equal(next().disabled, false);
    await act(async () => pending[0].resolve({ imported: 0, skipped: 1, keys: [] }));
    assert.match(h.document.querySelector('.backup-footer strong')!.textContent!, /Import 1/);
    assert.equal(next().disabled, false, 'an earlier count cannot overwrite the current selection');
  } finally { await h.close(); setShellApi(null); }
});

test('backup conflict bulk choices stay in the visible type and never restore deleted records', async () => {
  const preview: BackupPreview = { token: 'review-fixture', exportedAt: 1000, items: [
    previewItem('archive:a', 'archive', 'conflict', { title: 'Archive A' }), previewItem('archive:b', 'archive', 'conflict', { title: 'Archive B' }),
    previewItem('archive:deleted', 'archive', 'deleted', { title: 'Deleted archive' }), previewItem('decision:d', 'decision', 'conflict', { title: 'Decision D' })
  ] };
  let applied: string[] | null = null;
  setShellApi({ previewBackupSelection: countFixture(preview), applyBackup: async (_token: string, keys: string[]) => { applied = keys; return { imported: keys.length, skipped: 4 - keys.length }; } } as any);
  const h = await mountDom(<BackupWorkspace preview={preview} copy={getCopy('en')} locale="en" onClose={() => {}} onApplied={() => {}} />);
  const button = (label: string) => [...h.document.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent === label);
  try {
    const type = h.document.querySelector<HTMLSelectElement>('select[aria-label="Item type"]');
    assert.ok(type, 'type and status can be filtered independently');
    await act(async () => { type.value = 'archive'; type.dispatchEvent(new h.window.Event('change', { bubbles: true })); });
    await h.click(button('Conflicts only')!);
    assert.equal(h.document.querySelectorAll('.backup-list button').length, 2);
    await h.click(button('Use backup for 2 visible items')!);
    assert.equal(applied, null, 'bulk choices only edit the preview');
    assert.match(h.document.querySelector('.backup-footer strong')!.textContent!, /Import 2/);
    await h.click(button('Review & import')!);
    assert.ok(h.document.querySelector('.backup-summary')?.textContent?.includes('Archive A'));
    assert.ok(!h.document.querySelector('.backup-summary')?.textContent?.includes('Deleted archive'));
    assert.equal(applied, null, 'summary is a separate confirmation step');
    await h.click(button('Confirm import')!);
    assert.deepEqual(applied, ['archive:a', 'archive:b']);
  } finally { await h.close(); setShellApi(null); }
});

test('backup dependency names can be located and safe dependencies added without restoring tombstones', async () => {
  const preview: BackupPreview = { token: 'dependency-fixture', exportedAt: 1000, items: [
    previewItem('folderMembership:link', 'folderMembership', 'new', { title: 'Archive link', note: 'dependency_required', requires: ['folder:f', 'archive:a'] }),
    previewItem('folder:f', 'folder', 'deleted', { title: 'Deleted folder' }), previewItem('archive:a', 'archive', 'conflict', { title: 'Required answer' })
  ] };
  setShellApi({ previewBackupSelection: countFixture(preview) } as any);
  const h = await mountDom(<BackupWorkspace preview={preview} copy={getCopy('en')} locale="en" onClose={() => {}} onApplied={() => {}} />);
  try {
    const dependency = h.document.querySelector<HTMLButtonElement>('[data-dependency-key="folder:f"]');
    assert.ok(dependency?.textContent?.includes('Deleted folder'), 'required objects have navigable business names');
    const add = h.document.querySelector<HTMLButtonElement>('.backup-add-dependencies');
    assert.ok(add?.textContent?.includes('1'), 'dependency action states how many safe objects it adds');
    await h.click(add!);
    assert.match(h.document.querySelector('.backup-footer strong')!.textContent!, /Import 1/, 'deleted folder and unresolved link remain excluded');
    await h.click(dependency!);
    assert.equal(h.document.querySelector('.backup-comparison h3')!.textContent, 'Deleted folder');
    await h.click(h.document.querySelector<HTMLInputElement>('.backup-choice input')!);
    assert.match(h.document.querySelector('.backup-footer strong')!.textContent!, /Import 3/, 'explicit tombstone choice makes the link eligible');
  } finally { await h.close(); setShellApi(null); }
});
