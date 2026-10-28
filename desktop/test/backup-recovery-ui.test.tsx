import assert from 'node:assert/strict';
import test from 'node:test';
import { act } from 'react';
import { mountSettings, settingsButton, settingsCopy as copy, settingsShell, settingsStatus, settingsElement } from './ui/settings-dom';
import type { BackupExportMode } from '../src/shared/backup';
import { getCopy } from '../src/shared/copy';

const missing = [{ questionId: 'q-originals', title: 'Missing originals', count: 2, images: [] }];
const ready = { ...settingsStatus, imageSyncEnabled: true };

for (const [locale, message] of [
  ['en', 'Could not export the backup. Try again. If saving fails, choose another save location.'],
  ['zh-CN', '备份未能导出。请重试；若无法保存文件，可选择其他保存位置。'],
  ['zh-TW', '備份未能匯出。請重試；若無法儲存檔案，可選擇其他儲存位置。'],
] as const) for (const action of ['export', 'import']) test(`${locale} ${action} failure gives an operation-specific recovery`, async () => {
  const localized = getCopy(locale);
  const h = await mountSettings({ initialSection: 'backup', copy: localized, locale });
  settingsShell({ exportBackup: async () => { throw Error('backup_failed'); }, previewBackup: async () => { throw Error('backup_failed'); } });
  try {
    await h.click(settingsButton(h.document, action === 'export' ? localized.backupExport : localized.backupImport));
    assert.equal(h.document.querySelector('.archive-status')?.textContent, action === 'export' ? message : localized.backupFailed);
    assert.equal(settingsButton(h.document, localized.backupExport).disabled, false, 'retry remains available');
  } finally { await h.close(); }
});

for (const result of ['cancel', 'text-only', 'downloaded', 'save-cancelled'] as const) test(`missing-original export returns focus to its entry after ${result}`, async () => {
  const h = await mountSettings({ initialSection: 'backup', status: ready });
  settingsShell({ exportBackup: async (mode: BackupExportMode) => mode === 'complete' ? { missing } : result === 'text-only' ? 'text-only' : result === 'downloaded' });
  try {
    const opener = settingsButton(h.document, copy.backupExport);
    opener.focus(); await h.click(opener);
    const action = settingsButton(h.document, result === 'cancel' ? copy.cancel : result === 'downloaded' ? copy.backupDownloadOriginals : copy.backupTextOnly);
    action.focus(); await h.click(action);
    assert.equal(h.document.querySelector('.backup-missing') === null, true);
    assert.equal(h.document.activeElement === opener, true, 'closing the missing list returns to Export backup');
  } finally { await h.close(); }
});

test('late export completion does not reclaim focus after the user moves elsewhere', async () => {
  let finish!: (value: string) => void;
  const h = await mountSettings({ initialSection: 'backup', status: ready });
  settingsShell({ exportBackup: async (mode: BackupExportMode) => mode === 'complete' ? { missing } : new Promise(resolve => { finish = resolve; }) });
  try {
    await h.click(settingsButton(h.document, copy.backupExport));
    const action = settingsButton(h.document, copy.backupTextOnly); action.focus(); await h.click(action);
    const elsewhere = h.document.querySelector<HTMLInputElement>('input[name="question-image-sync"]')!;
    await h.click(h.document.querySelector<HTMLElement>('[data-settings-section=sync]')!);
    elsewhere.focus(); await act(async () => finish('text-only'));
    assert.equal(h.document.querySelector('.backup-missing') === null, true);
    assert.equal(h.document.activeElement === elsewhere, true, 'background completion keeps the new focus');
  } finally { await h.close(); }
});

for (const state of [
  { name: 'image sync off', status: { ...ready, imageSyncEnabled: false }, label: 'Go to image sync settings', target: 'question-image-sync-title' },
  { name: 'disconnected', status: { ...ready, connected: false }, label: 'Go to Drive connection', target: 'sync-title' },
  { name: 'authorization expired', status: { ...ready, state: 'auth' as const }, label: 'Go to Drive connection', target: 'sync-title' },
]) test(`missing-original recovery guides ${state.name} without enabling sync or downloading`, async () => {
  const modes: BackupExportMode[] = []; let connections = 0, enables = 0;
  const h = await mountSettings({ initialSection: 'backup', status: state.status });
  settingsShell({ exportBackup: async (mode: BackupExportMode) => { modes.push(mode); return { missing }; },
    connectSync: async () => { connections++; return ready; }, setImageSyncEnabled: async () => { enables++; return ready; } });
  try {
    await h.click(settingsButton(h.document, copy.backupExport));
    assert.equal(settingsButton(h.document, copy.backupDownloadOriginals) === undefined, true, 'download is replaced while prerequisites are unmet');
    const guidance = settingsButton(h.document, state.label);
    assert.equal(guidance !== undefined, true, 'the recovery offers the relevant settings destination');
    guidance.focus(); await h.click(guidance);
    assert.equal(h.document.activeElement?.id, state.target);
    assert.equal(h.document.querySelector('.backup-missing') !== null, true, 'navigation preserves the export task');
    assert.deepEqual(modes, ['complete']); assert.equal(connections, 0); assert.equal(enables, 0);
    await h.render(settingsElement({ initialSection: 'backup', status: ready }));
    const download = settingsButton(h.document, copy.backupDownloadOriginals);
    assert.equal(download !== undefined && !download.disabled, true, 'the existing task responds to updated sync status');
    await h.click(h.document.querySelector<HTMLElement>('[data-settings-section=backup]')!);
    await h.click(download); assert.deepEqual(modes, ['complete', 'download']);
  } finally { await h.close(); }
});

test('a failed download preserves the missing-original choices for retry', async () => {
  const h = await mountSettings({ initialSection: 'backup', status: ready });
  settingsShell({ exportBackup: async (mode: BackupExportMode) => { if (mode === 'download') throw new Error('backup_failed'); return { missing }; } });
  try {
    await h.click(settingsButton(h.document, copy.backupExport));
    await h.click(settingsButton(h.document, copy.backupDownloadOriginals));
    assert.equal(h.document.querySelector('.backup-missing') !== null, true);
    assert.equal(settingsButton(h.document, copy.backupDownloadOriginals).disabled, false);
    assert.equal(h.document.querySelector('.archive-status')?.textContent, copy.backupExportFailed);
  } finally { await h.close(); }
});


test('cancelling an in-flight download returns to the backup heading without late focus theft', async () => {
  let finish!: (value: { missing: typeof missing }) => void;
  const h = await mountSettings({ initialSection: 'backup', status: ready });
  settingsShell({ exportBackup: async (mode: BackupExportMode) => mode === 'complete' ? { missing } : new Promise(resolve => { finish = resolve; }) });
  try {
    await h.click(settingsButton(h.document, copy.backupExport));
    const download = settingsButton(h.document, copy.backupDownloadOriginals); download.focus(); await h.click(download);
    const cancel = settingsButton(h.document, copy.cancel); cancel.focus(); await h.click(cancel);
    assert.equal(h.document.querySelector('.backup-missing') === null, true);
    assert.equal(h.document.activeElement?.id, 'backup-card-title', 'the stable heading is available while the export entry is disabled');
    const elsewhere = h.document.querySelector<HTMLInputElement>('input[name="question-image-sync"]')!;
    await h.click(h.document.querySelector<HTMLElement>('[data-settings-section=sync]')!);
    elsewhere.focus(); await act(async () => finish({ missing }));
    assert.equal(h.document.querySelector('.backup-missing') === null, true, 'late response cannot reopen the cancelled task');
    assert.equal(h.document.activeElement === elsewhere, true);
  } finally { await h.close(); }
});

for (const outcome of ['failed', 'incomplete'] as const) {
  for (const moved of [false, true]) test(`${outcome} download ${moved ? 'preserves moved' : 'recovers lost'} keyboard focus`, async () => {
    let finish!: () => void;
    const h = await mountSettings({ initialSection: 'backup', status: ready });
    settingsShell({ exportBackup: async (mode: BackupExportMode) => mode === 'complete' ? { missing } : new Promise((resolve, reject) => {
      finish = () => outcome === 'failed' ? reject(new Error('backup_failed')) : resolve({ missing });
    }) });
    try {
      await h.click(settingsButton(h.document, copy.backupExport));
      const download = settingsButton(h.document, copy.backupDownloadOriginals);
      download.focus(); await h.click(download);
      assert.equal(download.disabled, true);
      // Chromium drops focus when the button is disabled; jsdom needs that native transition explicitly.
      h.document.body.tabIndex = -1; h.document.body.focus();
      assert.equal(h.document.activeElement === h.document.body, true);
      const elsewhere = h.document.querySelector<HTMLInputElement>('input[name="question-image-sync"]')!;
      if (moved) { await h.click(h.document.querySelector<HTMLElement>('[data-settings-section=sync]')!); elsewhere.focus(); }
      await act(async () => finish());
      assert.equal(download.disabled, false);
      assert.equal(h.document.activeElement === (moved ? elsewhere : download), true);
      assert.equal(h.document.querySelector('.backup-missing') !== null, true);
    } finally { await h.close(); }
  });
}
