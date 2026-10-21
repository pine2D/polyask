import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act, useState } from 'react';
import { BackupCard, BackupWorkspace } from '../src/renderer/backup-workspace';
import { getCopy } from '../src/shared/copy';
import { setShellApi } from '../src/renderer/shell-api';
import { mountDom } from './ui/dom-harness';
import type { BackupExportMode, BackupPreview } from '../src/shared/backup';
const missing = [{ questionId: 'unknown', title: 'Question without image names', count: 2, images: [] },
  { questionId: 'known', title: 'Question with known images', count: 1, images: [{ name: 'original.png', type: 'image/png' as const, size: 8, sha256: 'a'.repeat(64) }] }];
for (const locale of ['en', 'zh-CN', 'zh-TW']) test(`missing originals offer explicit choices and accurate feedback in ${locale}`, async () => {
  const copy = getCopy(locale), modes: (BackupExportMode | undefined)[] = [], cancelled: string[] = [], feedback: string[] = [];
  setShellApi({ exportBackup: async (mode?: BackupExportMode) => { modes.push(mode); return mode === 'text-only' ? 'text-only' : { missing }; },
    cancelBackup: async (token: string) => { cancelled.push(token); } } as any);
  function App() { const [busy, onBusy] = useState(false); return <BackupCard copy={copy} locale={locale} busy={busy} onBusy={onBusy} onFeedback={message => feedback.push(message)} />; }
  const h = await mountDom(<App />);
  const button = (text: string) => [...h.document.querySelectorAll<HTMLButtonElement>('button')].find(el => el.textContent === text)!;
  try {
    await h.click(button(copy.backupExport));
    assert.equal(h.document.querySelectorAll('.backup-missing li').length, 2);
    assert.equal(h.document.querySelectorAll('.backup-missing li')[0].textContent!.includes('2'), true);
    assert.equal(h.document.querySelectorAll('.backup-missing li')[0].textContent!.includes('original.png'), false);
    assert.equal(h.document.querySelectorAll('.backup-missing li')[1].textContent!.includes('original.png'), true);
    assert.equal(h.document.activeElement?.id, 'backup-missing-title');
    await h.click(button(copy.backupDownloadOriginals));
    assert.deepEqual(modes, ['complete', 'download']);
    assert.equal(feedback.length, 0, 'failed download is not a successful backup');
    await h.click(button(copy.cancel)); assert.equal(h.document.querySelector('.backup-missing') === null, true);
    assert.deepEqual(cancelled, ['pending']);
    await h.click(button(copy.backupExport)); await h.click(button(copy.backupTextOnly));
    assert.equal(feedback[0], copy.backupTextOnlyExported);
    assert.equal(feedback.includes(copy.backupExported), false);
  } finally { await h.close(); setShellApi(null); }
});
test('unmount cancels pending export and ignores late success', async () => {
  let finish!: (value: boolean) => void;
  const cancelled: string[] = [], feedback: string[] = [];
  setShellApi({ exportBackup: () => new Promise(resolve => { finish = resolve; }), cancelBackup: async (token: string) => { cancelled.push(token); } } as any);
  const copy = getCopy('en');
  const h = await mountDom(<BackupCard copy={copy} locale="en" busy={false} onBusy={() => {}} onFeedback={message => feedback.push(message)} />);
  await h.click([...h.document.querySelectorAll<HTMLButtonElement>('button')].find(el => el.textContent === copy.backupExport)!);
  await h.close();
  await act(async () => finish(true));
  assert.deepEqual(cancelled, ['pending']); assert.equal(feedback.length, 0); setShellApi(null);
});
test('text-only import preview visibly explains image omissions', async () => {
  const preview: BackupPreview = { token: 'text', exportedAt: 100, items: [], omissions: missing.map(({ title, ...item }) => item) };
  setShellApi({ previewBackupSelection: async () => ({ imported: 0, skipped: 0, keys: [] }) } as any);
  const h = await mountDom(<BackupWorkspace preview={preview} copy={getCopy('en')} locale="en" onClose={() => {}} onApplied={() => {}} />);
  try { assert.match(h.document.querySelector('[role="note"]')!.textContent!, /omits original images for 2 questions/); }
  finally { await h.close(); setShellApi(null); }
});

test('cancel during explicit download ignores its late result and feedback', async () => {
  let finish!: (value: any) => void;
  const feedback: string[] = [], cancelled: string[] = [];
  setShellApi({ exportBackup: async (mode: BackupExportMode) => mode === 'download' ? new Promise(resolve => { finish = resolve; }) : { missing },
    cancelBackup: async (token: string) => { cancelled.push(token); } } as any);
  const copy = getCopy('en');
  function App() { const [busy, onBusy] = useState(false); return <BackupCard copy={copy} locale="en" busy={busy} onBusy={onBusy} onFeedback={message => feedback.push(message)} />; }
  const h = await mountDom(<App />);
  const button = (text: string) => [...h.document.querySelectorAll<HTMLButtonElement>('button')].find(el => el.textContent === text)!;
  try {
    await h.click(button(copy.backupExport)); await h.click(button(copy.backupDownloadOriginals));
    assert.equal(button(copy.cancel).disabled, false);
    await h.click(button(copy.cancel)); await act(async () => finish({ missing }));
    assert.equal(h.document.querySelector('.backup-missing') === null, true);
    assert.equal(feedback.length, 0); assert.deepEqual(cancelled, ['pending']);
  } finally { await h.close(); setShellApi(null); }
});

for (const locale of ['en', 'zh-CN', 'zh-TW']) test(`original-image terminal tombstone and missing payload preview are explained in ${locale}`, async () => {
  const { renderToStaticMarkup } = await import('react-dom/server');
  const { BackupComparison } = await import('../src/renderer/backup-comparison');
  const copy = getCopy(locale);
  const base = { key: 'questionAttachments:a', kind: 'questionAttachments' as const, id: 'a', title: 'Originals', local: null, backup: {} };
  const deleted = renderToStaticMarkup(<BackupComparison item={{ ...base, status: 'deleted', blocked: true }} copy={copy} selected={false} onSelect={() => {}} />);
  assert.equal(deleted.includes(copy.backupOriginalsBlocked), true);
  const missing = renderToStaticMarkup(<BackupComparison item={{ ...base, status: 'conflict', note: 'originals_unavailable' }} copy={copy} selected={false} onSelect={() => {}} />);
  assert.equal(missing.includes(copy.backupMissingOriginals), true);
});
