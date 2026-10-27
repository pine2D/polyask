import assert from 'node:assert/strict';
import test from 'node:test';
import { act } from 'react';
import { focusableControls } from '../src/renderer/focusable-controls';
import { requestDecisionNavigation } from '../src/renderer/decision-navigation';
import { mountSettings, settingsButton, settingsCopy as copy, settingsShell } from './ui/settings-dom';

type Harness = Awaited<ReturnType<typeof mountSettings>>;
async function navigate(h: Harness, category: string) {
  const button = h.document.querySelector<HTMLButtonElement>(`[data-settings-section="${category}"]`);
  assert.equal(button !== null, true, `category ${category} exists`);
  await h.click(button!); return button!;
}

test('only one category is visible and hidden cards never enter keyboard traversal', async () => {
  const h = await mountSettings();
  try {
    assert.equal(h.document.querySelectorAll('[data-settings-category]').length, 7);
    assert.equal(h.document.querySelector('[data-settings-category]:not([hidden])')?.getAttribute('data-settings-category'), 'appearance');
    for (const category of ['interaction', 'sync', 'backup', 'network', 'data', 'about', 'appearance']) {
      await navigate(h, category);
      assert.equal(h.document.querySelectorAll('[data-settings-category]:not([hidden])').length, 1);
      assert.equal(h.document.activeElement?.id, `settings-category-${category}`);
      for (const panel of h.document.querySelectorAll<HTMLElement>('[data-settings-category][hidden]')) {
        assert.equal(panel.hasAttribute('inert'), true);
        assert.equal(focusableControls(panel).length, 0);
      }
    }
  } finally { await h.close(); }
});

test('proxy and global shortcut drafts survive category changes without another secret read', async () => {
  const h = await mountSettings(); let reads = 0;
  settingsShell({ getProxyState: async () => { reads++; throw Error('must not reread'); } });
  try {
    await navigate(h, 'network'); await h.click(h.document.getElementById('settings-proxy-mode-custom')!);
    await h.input(h.document.querySelector<HTMLInputElement>('#settings-proxy-host')!, 'unsaved.example');
    await navigate(h, 'interaction'); await h.click(h.document.querySelector<HTMLInputElement>('.settings-global-shortcut input[value="Control"]')!);
    await act(async () => { const select = h.document.querySelector<HTMLSelectElement>('#global-prompt-shortcut-key')!; select.value = 'Q'; select.dispatchEvent(new h.window.Event('change', { bubbles: true })); });
    await navigate(h, 'sync'); await navigate(h, 'network');
    assert.equal(h.document.querySelector<HTMLInputElement>('#settings-proxy-host')!.value, 'unsaved.example');
    await navigate(h, 'interaction');
    assert.equal(h.document.querySelector<HTMLSelectElement>('#global-prompt-shortcut-key')!.value, 'Q');
    assert.equal(h.document.querySelector<HTMLInputElement>('.settings-global-shortcut input[value="Control"]')!.checked, true);
    assert.equal(reads, 0);
  } finally { await h.close(); }
});

for (const kind of ['proxy', 'shortcut'] as const) test(`${kind}: leaving settings from another category still shows a usable draft confirmation`, async () => {
  const h = await mountSettings(); let leaves = 0;
  try {
    await navigate(h, kind === 'proxy' ? 'network' : 'interaction');
    if (kind === 'proxy') await h.click(h.document.getElementById('settings-proxy-mode-custom')!);
    else await h.click(h.document.querySelector<HTMLInputElement>('.settings-global-shortcut input[value="Control"]')!);
    await navigate(h, 'appearance');
    await act(async () => requestDecisionNavigation(() => { leaves++; }, { kind: 'surface', surface: 'sites' }));
    const dialog = h.document.querySelector<HTMLElement>('[role="dialog"]');
    assert.equal(dialog !== null, true); assert.equal(dialog!.closest('[hidden],[inert]') === null, true);
    assert.equal(focusableControls(dialog!).length > 0, true); assert.equal(leaves, 0);
    await h.click(settingsButton(h.document, kind === 'proxy' ? copy.proxyKeepEditing : copy.globalShortcutKeepEditing));
    assert.equal(leaves, 0);
  } finally { await h.close(); }
});

for (const kind of ['proxy', 'shortcut'] as const) test(`${kind}: delayed failure in a hidden category preserves navigation focus and feedback`, async () => {
  let fail!: () => void;
  const h = await mountSettings({ onCheckUpdates: async () => {} });
  settingsShell({ testProxy: () => new Promise((_resolve, reject) => { fail = () => reject(Error('proxy_failed')); }),
    setGlobalPromptShortcut: () => new Promise((_resolve, reject) => { fail = () => reject(Error('save_failed')); }) });
  try {
    await navigate(h, kind === 'proxy' ? 'network' : 'interaction');
    if (kind === 'shortcut') {
      await h.click(h.document.querySelector<HTMLInputElement>('.settings-global-shortcut input[value="Control"]')!);
      await act(async () => { const select = h.document.querySelector<HTMLSelectElement>('#global-prompt-shortcut-key')!; select.value = 'Q'; select.dispatchEvent(new h.window.Event('change', { bubbles: true })); });
    }
    const start = settingsButton(h.document, kind === 'proxy' ? copy.proxyTest : copy.globalShortcutSave); start.focus(); await h.click(start);
    const navigation = await navigate(h, 'appearance'); navigation.focus();
    await act(async () => fail());
    assert.equal(h.document.activeElement === navigation, true);
    await navigate(h, 'about'); await h.click(settingsButton(h.document, copy.checkForUpdates));
    await navigate(h, kind === 'proxy' ? 'network' : 'interaction');
    assert.equal(h.document.body.textContent?.includes(kind === 'proxy' ? copy.proxyResultFailed : copy.globalShortcutSaveFailed), true);
  } finally { await h.close(); }
});

test('a pending backup preview stays available without opening a hidden category or taking focus', async () => {
  let finish!: (value: unknown) => void;
  const h = await mountSettings();
  settingsShell({ previewBackup: () => new Promise(resolve => { finish = resolve; }),
    previewBackupSelection: async () => ({ imported: 0, skipped: 0, keys: [] }) });
  try {
    await navigate(h, 'backup'); await h.click(settingsButton(h.document, copy.backupImport));
    const navigation = await navigate(h, 'appearance'); navigation.focus();
    await act(async () => finish({ token: 'synthetic-preview', filename: 'synthetic.json', exportedAt: 1, items: [] }));
    const dialog = h.document.querySelector<HTMLElement>('.backup-workspace');
    assert.equal(dialog !== null, true);
    assert.equal(dialog!.closest('[hidden],[inert]') !== null, true);
    assert.equal(h.document.activeElement === navigation, true);
    await navigate(h, 'backup');
    assert.equal(dialog!.closest('[hidden],[inert]') === null, true);
    assert.equal(dialog!.textContent?.includes('synthetic.json'), true);
  } finally { await h.close(); }
});

test('leaving data clears cloud confirmation and returning never reuses DELETE', async () => {
  const h = await mountSettings({ initialSection: 'data' });
  try {
    const input = h.document.querySelector<HTMLInputElement>('[name="clear-cloud-confirmation"]')!;
    await h.input(input, 'DELETE'); await navigate(h, 'appearance'); await navigate(h, 'data');
    assert.equal(input.value, ''); assert.equal(settingsButton(h.document, copy.syncClear).disabled, true);
  } finally { await h.close(); }
});

test('an explicit settings command preserves an open backup preview and its review state', async () => {
  const h = await mountSettings(); let navigations = 0, cancellations = 0;
  settingsShell({ previewBackup: async () => ({ token: 'retained-preview', exportedAt: 1, items: [] }),
    previewBackupSelection: async () => ({ imported: 0, skipped: 0, keys: [] }), cancelBackup: async () => { cancellations++; } });
  try {
    await navigate(h, 'backup'); await h.click(settingsButton(h.document, copy.backupImport));
    assert.equal(h.document.querySelector('.backup-workspace') !== null, true);
    await act(async () => requestDecisionNavigation(() => { navigations++; }, { kind: 'command', id: 'open-display-settings' }));
    assert.equal(navigations, 1);
    assert.equal(cancellations, 0, 'a settings-only command does not cancel the selected backup');
    assert.equal(h.document.querySelector('.backup-workspace') !== null, true);
  } finally { await h.close(); }
});

for (const operation of ['notification', 'missing-originals'] as const) test(`${operation}: a hidden asynchronous result cannot focus even when focus is on body`, async () => {
  let finish!: (value: unknown) => void;
  const h = await mountSettings();
  settingsShell({ testNotification: () => new Promise(resolve => { finish = resolve; }),
    exportBackup: () => new Promise(resolve => { finish = resolve; }) });
  try {
    await navigate(h, operation === 'notification' ? 'interaction' : 'backup');
    const start = operation === 'notification'
      ? h.document.querySelector<HTMLButtonElement>('section[aria-labelledby="completion-notifications-title"] button')!
      : settingsButton(h.document, copy.backupExport);
    start.focus(); await h.click(start);
    await navigate(h, 'appearance'); h.document.body.tabIndex = -1; h.document.body.focus();
    await act(async () => finish(operation === 'notification' ? { state: 'failed', revision: 2 }
      : { missing: [{ questionId: 'synthetic', title: 'Synthetic question', count: 1, images: [] }] }));
    assert.equal(h.document.activeElement === h.document.body, true);
  } finally { await h.close(); }
});
